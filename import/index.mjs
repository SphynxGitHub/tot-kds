import { loadWorkbook } from './lib/xlsx.mjs';
import { reconcile } from './reconcile.mjs';
import { importLocations } from './steps/locations.mjs';
import { importEvents } from './steps/events.mjs';
import { importMenu } from './steps/menu.mjs';
import { importKdsOrders, importWaveOrders, buildCustomers } from './steps/orders.mjs';
import {
  importIncomeHistory, importExpenses, importCashSessions, importTaxFilings, importInventory,
} from './steps/finance.mjs';

const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

/**
 * Imports the three business workbooks into the database.
 * db: any object with query(sql, params) -> { rows }  (pg Client or PGlite)
 * files: { sales, hospitality, schedule } paths to the .xlsx files
 * Safe to re-run: existing rows are never overwritten or duplicated.
 */
export async function runImport({ db, files, dryRun = false, log = console.log }) {
  const ctx = {
    db, today: todayET(), notes: [], stats: {},
    note(msg) { this.notes.push(msg); },
    wb: {},
  };
  log('Reading workbooks...');
  [ctx.wb.sl, ctx.wb.hw, ctx.wb.sc] = await Promise.all([
    loadWorkbook(files.sales), loadWorkbook(files.hospitality), loadWorkbook(files.schedule),
  ]);

  const steps = [
    ['locations and tax rates', importLocations],
    ['schedule', importEvents],
    ['menu and recipes', importMenu],
    ['order history', importKdsOrders],
    ['pre-order waves', importWaveOrders],
    ['customers', buildCustomers],
    ['income history', importIncomeHistory],
    ['expenses', importExpenses],
    ['cash drawer sessions', importCashSessions],
    ['sales tax filings', importTaxFilings],
    ['inventory', importInventory],
  ];

  let report;
  await db.query('begin');
  await db.query("select set_config('app.importing','on',true)");
  try {
    for (const [label, fn] of steps) {
      log(`Importing ${label}...`);
      await fn(ctx);
    }
    log('Checking totals against the spreadsheets...');
    report = await reconcile({ db, wb: ctx.wb });
    if (!report.ok && !dryRun) {
      throw new Error(`Reconciliation failed, nothing was saved.\n${report.text}`);
    }
    await db.query(dryRun ? 'rollback' : 'commit');
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
  return { stats: ctx.stats, notes: ctx.notes, dryRun, report };
}
