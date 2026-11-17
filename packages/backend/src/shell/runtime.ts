import { EventEmitter } from 'node:events';
import vm from 'node:vm';

import type { ShellOutput } from '@thicket/contract';
import { ShellApiAutocompleter } from '@mongosh/browser-runtime-core/lib/autocompleter/shell-api-autocompleter.js';
import { NodeDriverServiceProvider } from '@mongosh/service-provider-node-driver';
import { ShellInstanceState } from '@mongosh/shell-api';
import { ShellEvaluator } from '@mongosh/shell-evaluator';
import type { MongoClientOptions } from 'mongodb';

import { errorOutput, printOutput, resultOutput, type ShellResultLike } from './output.ts';
import { EXIT_TEXT, isExitCommand, splitShellInput } from './split.ts';

// The mongosh packages are CommonJS: named imports work in Node's ESM loader (cjs-module-lexer;
// the worker runs from source in tests) and in the esbuild bundle alike.

type ServiceProvider = Awaited<ReturnType<typeof NodeDriverServiceProvider.connect>>;
type State = InstanceType<typeof ShellInstanceState>;

/** Product info mongosh puts into its log and help texts. */
const PRODUCT = {
  productName: 'Thicket',
  productDocsLink: 'https://github.com/oldpeasant/thicket',
};

/**
 * One mongosh session (docs/mongosh.md "Eval"): its own `MongoClient`, `ShellInstanceState`,
 * evaluator and `vm` context, so variables, functions and the current db persist between inputs.
 * Runs inside a shell worker; nothing here may block the backend thread.
 */
export class ShellRuntime {
  private readonly context: vm.Context = vm.createContext({});
  private readonly state: State;
  private readonly evaluator: InstanceType<typeof ShellEvaluator>;
  private completer: InstanceType<typeof ShellApiAutocompleter> | undefined;
  private emit: (output: ShellOutput) => void = () => undefined;
  /** The evaluation in progress (`evaluateAll` reports its errors as output: never rejects). */
  private running: Promise<void> | undefined;
  private interrupting: Promise<void> | undefined;
  private readonly provider: ServiceProvider;

  // No parameter properties in this file: the worker runs from source with Node's type stripping.
  private constructor(provider: ServiceProvider) {
    this.provider = provider;
    const bus = new EventEmitter();
    this.state = new ShellInstanceState(provider, bus);
    this.state.isInteractive = true;
    this.state.setCtx(this.context);
    this.evaluator = new ShellEvaluator(this.state);
    this.state.setEvaluationListener({
      onPrint: (values: ShellResultLike[], kind?: string) => {
        this.emit(printOutput(values, kind));
      },
      // No interactive prompts in the console (yet): `passwordPrompt()` and yes/no questions fail.
      onPrompt: () => {
        throw new Error('Interactive prompts are not supported in the Thicket console');
      },
    });
    // mongosh's exit() closes the session's client before its onExit listener runs: replace the
    // functions (the `exit`/`quit` commands are caught in evaluateAll), the session stays usable.
    const noExit = () => {
      throw new Error(EXIT_TEXT);
    };
    const globals = this.context as Record<string, unknown>;
    globals['exit'] = noExit;
    globals['quit'] = noExit;
  }

  /** Connects with the profile's driver configuration and switches to `db` when given. */
  static async open(
    uri: string,
    options: MongoClientOptions,
    db: string | undefined,
  ): Promise<ShellRuntime> {
    const provider = await NodeDriverServiceProvider.connect(
      uri,
      { ...PRODUCT, ...options },
      {},
      new EventEmitter(),
    );
    const runtime = new ShellRuntime(provider);
    if (db !== undefined) runtime.state.setDbFunc(runtime.state.currentDb.getSiblingDB(db));
    return runtime;
  }

  /** The current database. */
  db(): string {
    // `_name`, not `getName()`: shell API calls throw while an interrupt is in progress.
    return String(this.state.currentDb._name);
  }

  /**
   * Evaluates console input piece by piece (`splitShellInput`), sending output as it comes:
   * printed text, each piece's result, a `db` event when the current database changed, and an
   * `error` that ends the evaluation.
   */
  async evaluate(code: string, emit: (output: ShellOutput) => void): Promise<void> {
    const run = this.evaluateAll(code, emit);
    this.running = run;
    try {
      await run;
    } finally {
      this.running = undefined;
      this.emit = () => undefined;
      // An interrupted evaluation is over only once the session has reconnected: input sent
      // before that would fail as interrupted too.
      await this.interrupting?.catch(() => undefined);
    }
  }

  private async evaluateAll(code: string, emit: (output: ShellOutput) => void): Promise<void> {
    this.emit = emit;
    for (const piece of splitShellInput(code)) {
      if (isExitCommand(piece)) {
        emit({ kind: 'print', text: EXIT_TEXT });
        continue;
      }
      const before = this.db();
      try {
        const result = (await this.evaluator.customEval(
          (input: string) => vm.runInContext(input, this.context),
          piece,
          this.context,
          '',
        )) as ShellResultLike;
        const output = resultOutput(result);
        if (output) emit(output);
      } catch (error) {
        emit(errorOutput(error));
        return;
      } finally {
        const after = this.db();
        if (after !== before) emit({ kind: 'db', db: after });
      }
    }
  }

  /**
   * Completions for `code` (the input up to the cursor), as mongosh gives them: the whole input
   * with the completed last word (`db.c.fi` -> `db.c.find`, `db.c.findOne`, ...).
   */
  async complete(code: string): Promise<string[]> {
    if (!this.completer) {
      await this.state.fetchConnectionInfo();
      this.completer = new ShellApiAutocompleter(this.state);
    }
    const completions = await this.completer.getCompletions(code);
    return completions.map((c: { completion: string }) => c.completion);
  }

  /**
   * Interrupts the running evaluation (it fails with `MongoshInterruptedError`, the server aborts
   * its operation: the session's client is closed), then reconnects so the session goes on.
   */
  async interrupt(): Promise<void> {
    const running = this.running;
    if (!running) return;
    this.interrupting ??= (async () => {
      try {
        await this.state.onInterruptExecution();
        await running;
        await this.state.onResumeExecution();
      } finally {
        this.interrupting = undefined;
      }
    })();
    await this.interrupting;
  }

  async close(): Promise<void> {
    await this.provider.close();
  }
}
