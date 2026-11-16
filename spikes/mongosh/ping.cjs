// Throwaway prototype for the mongosh-spike task (see docs/mongosh.md). Not product code.
//
// Hosts the real mongosh runtime in a plain Node process (the same API surface the backend
// utilityProcess has) and exercises: eval, printing, typed output, `use db`, completion and
// interrupt. Usage: MONGO_URI=mongodb://127.0.0.1:27399 node ping.cjs
/* global require, console, process, setTimeout */
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS on purpose: the mongosh packages are CJS */
'use strict';

const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { NodeDriverServiceProvider } = require('@mongosh/service-provider-node-driver');
const { ShellInstanceState } = require('@mongosh/shell-api');
const { ShellEvaluator } = require('@mongosh/shell-evaluator');
const {
  ShellApiAutocompleter,
} = require('@mongosh/browser-runtime-core/lib/autocompleter/shell-api-autocompleter');

// Same as ElectronRuntime/OpenContextRuntime, but keeps a handle on the ShellInstanceState so
// the host can interrupt (ElectronRuntime exposes no interrupt).
class ThicketShellRuntime {
  constructor(serviceProvider, bus) {
    this.context = {};
    vm.createContext(this.context);
    this.state = new ShellInstanceState(serviceProvider, bus);
    this.state.isInteractive = true;
    this.evaluator = new ShellEvaluator(this.state);
    this.state.setCtx(this.context);
    this.completer = null;
  }
  setEvaluationListener(listener) {
    this.state.setEvaluationListener(listener);
  }
  async evaluate(code) {
    const sloppyEval = (input) => vm.runInContext(input, this.context);
    const r = await this.evaluator.customEval(sloppyEval, code, this.context, '');
    return { type: r.type, printable: r.printable, rawValue: r.rawValue, source: r.source };
  }
  async complete(code) {
    if (!this.completer) {
      await this.state.fetchConnectionInfo();
      this.completer = new ShellApiAutocompleter(this.state);
    }
    return (await this.completer.getCompletions(code)).map((c) => c.completion);
  }
  async interrupt() {
    await this.state.onInterruptExecution();
  }
  async resume() {
    await this.state.onResumeExecution();
  }
  prompt() {
    return this.state.getDefaultPrompt();
  }
}

function show(label, value) {
  console.log(`--- ${label}`);
  console.dir(value, { depth: 6 });
}

async function main() {
  const uri = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27399';
  const bus = new EventEmitter();
  const t0 = Date.now();
  const sp = await NodeDriverServiceProvider.connect(
    uri,
    {
      productName: 'Thicket',
      productDocsLink: 'https://example.invalid/thicket',
      serverSelectionTimeoutMS: 5000,
    },
    {},
    bus,
  );
  const rt = new ThicketShellRuntime(sp, bus);
  const printed = [];
  rt.setEvaluationListener({
    onPrint: (values) => {
      printed.push(...values);
      for (const v of values) console.log('[print]', v.type, v.printable);
    },
  });
  console.log(`connected in ${Date.now() - t0} ms; prompt: ${await rt.prompt()}`);

  show('db.runCommand({ping:1})', await rt.evaluate('db.runCommand({ping:1})'));
  show('use thicketspike', await rt.evaluate('use thicketspike'));
  await rt.evaluate(
    'db.orders.drop(); db.orders.insertMany([{n:1,at:new Date(0)},{n:2,big:NumberLong("9007199254740993")}])',
  );
  show('db.orders.countDocuments()', await rt.evaluate('db.orders.countDocuments()'));
  const cur = await rt.evaluate('db.orders.find({}, {_id:0})');
  show('db.orders.find() type + printable', { type: cur.type, printable: cur.printable });
  show('print + return', await rt.evaluate('print("hello", 1); printjson({a:1}); 42'));
  show('plain JS value', await rt.evaluate('const x = {a: [1,2]}; x'));
  show('multi-line input', await rt.evaluate('function f(a) {\n  return a * 2;\n}\nf(21)'));
  try {
    await rt.evaluate('db.orders.insertOne({_id: 1}); db.orders.insertOne({_id: 1})');
  } catch (e) {
    show('server error', { name: e.name, code: e.code, message: e.message });
  }
  try {
    await rt.evaluate('throw new Error("boom")');
  } catch (e) {
    show('user error', { name: e.name, message: e.message });
  }

  show('complete "db.ord"', await rt.complete('db.ord'));
  show('complete "db.orders.fin"', await rt.complete('db.orders.fin'));
  show('complete "db.orders.find({n"', (await rt.complete('db.orders.find({n')).slice(0, 10));

  // Interrupt an async loop (each iteration is a server round trip).
  const loop = rt.evaluate('let i = 0; while (true) { db.runCommand({ping:1}); i++ }');
  let interrupting;
  setTimeout(() => (interrupting = rt.interrupt()), 300);
  try {
    await loop;
    console.log('--- interrupt: loop finished?!');
  } catch (e) {
    show('interrupt async loop', { name: e.name, message: e.message });
  }
  await interrupting; // suspend (closes the client) must finish before resume reconnects
  await rt.resume();
  show(
    'after resume: i > 0 and shell still works',
    await rt.evaluate('({ i, ok: db.runCommand({ping:1}).ok })'),
  );

  // Interrupt a slow server op (server-side sleep in $where, ~5 s per document).
  await rt.evaluate('use thicketspike');
  const slow = rt.evaluate('db.orders.find({ $where: "sleep(5000) || true" }).toArray()');
  const t1 = Date.now();
  setTimeout(() => (interrupting = rt.interrupt()), 300);
  try {
    await slow;
  } catch (e) {
    show(`interrupt slow server op after ${Date.now() - t1} ms`, {
      name: e.name,
      message: e.message,
    });
  }
  await interrupting; // suspend (closes the client) must finish before resume reconnects
  await rt.resume();
  show('after resume 2', await rt.evaluate('db.runCommand({ping:1})'));

  // A synchronous loop never yields; only a vm timeout (or killing the process) stops it.
  try {
    vm.runInContext('while (true) {}', rt.context, { timeout: 200 });
  } catch (e) {
    show('sync loop with vm timeout', { code: e.code, message: e.message });
  }

  await rt.evaluate('db.dropDatabase()');
  await sp.close(true);
  console.log('done');
}

main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
