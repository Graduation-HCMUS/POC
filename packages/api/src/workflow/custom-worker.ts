import { limits } from '@packages/contracts';
import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS, Scope } from 'quickjs-emscripten';

import type { CustomJob, CustomReply } from './custom.ts';

async function run({ code, input }: CustomJob): Promise<CustomReply> {
  const quickjs = await getQuickJS();
  const runtime = quickjs.newRuntime();
  const deadline = Date.now() + limits.customCodeMs;
  runtime.setMemoryLimit(limits.customMemoryBytes);
  runtime.setMaxStackSize(256 * 1024);
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const vm = runtime.newContext();
  let phase: 'CUSTOM_SYNTAX' | 'CUSTOM_EXECUTION' = 'CUSTOM_SYNTAX';

  try {
    return Scope.withScope((scope): CustomReply => {
      const compile = scope.manage(
        vm.unwrapResult(
          vm.evalCode(
            `(source) => Function('items', '"use strict";\\n' + source)`,
          ),
        ),
      );
      const source = scope.manage(vm.newString(code));
      const transform = scope.manage(
        vm.unwrapResult(vm.callFunction(compile, vm.undefined, source)),
      );
      phase = 'CUSTOM_EXECUTION';
      const invoke = scope.manage(
        vm.unwrapResult(
          vm.evalCode(`(transform, rawInput) => {
        const stringify = JSON.stringify;
        const isArray = Array.isArray;
        const result = transform(JSON.parse(rawInput));
        return isArray(result) ? stringify(result) : undefined;
      }`),
        ),
      );
      const rawInput = scope.manage(vm.newString(input));
      const value = scope.manage(
        vm.unwrapResult(
          vm.callFunction(invoke, vm.undefined, transform, rawInput),
        ),
      );
      if (vm.typeof(value) !== 'string') {
        return {
          ok: false,
          code: 'CUSTOM_OUTPUT',
          message: 'Return an array of items.',
        };
      }
      const output = vm.getString(value);
      if (Buffer.byteLength(output) > limits.customDataBytes) {
        return {
          ok: false,
          code: 'CUSTOM_OUTPUT',
          message: 'Custom output exceeds 2 MiB.',
        };
      }
      return { ok: true, output };
    });
  } catch (error) {
    if (Date.now() >= deadline) {
      return {
        ok: false,
        code: 'CUSTOM_TIMEOUT',
        message: 'JavaScript exceeded its execution time limit.',
      };
    }
    return {
      ok: false,
      code: phase,
      message:
        error instanceof Error
          ? error.message.slice(0, 500)
          : 'JavaScript could not complete.',
    };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

if (!parentPort) throw new Error('Custom Code requires a worker thread.');
parentPort.postMessage(await run(workerData as CustomJob));
