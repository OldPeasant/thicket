import { RpcError, type Handler } from '@thicket/backend';
import type { ParsedParamsOf, ResultOf } from '@thicket/contract';

import {
  PipelineNameTakenError,
  PipelineNotFoundError,
  PipelinesReadOnlyError,
  type PipelinesStore,
} from './store';

async function mapErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PipelineNotFoundError) throw new RpcError('NOT_FOUND', error.message);
    if (error instanceof PipelineNameTakenError) throw new RpcError('CONFLICT', error.message);
    if (error instanceof PipelinesReadOnlyError) throw new RpcError('UNSUPPORTED', error.message);
    throw error;
  }
}

/** `pipelines.list/save/rename/delete` (served by `main`, stored in `pipelines.json`). */
export function pipelinesHandlers(store: PipelinesStore): Record<string, Handler> {
  return {
    'pipelines.list': async (
      params: ParsedParamsOf<'pipelines.list'>,
    ): Promise<ResultOf<'pipelines.list'>> => ({ pipelines: await store.list(params) }),
    'pipelines.save': (
      params: ParsedParamsOf<'pipelines.save'>,
    ): Promise<ResultOf<'pipelines.save'>> =>
      mapErrors(async () => {
        const { profileId, db, coll, name, stages } = params;
        return { saved: await store.save({ profileId, db, coll }, name, stages) };
      }),
    'pipelines.rename': (
      params: ParsedParamsOf<'pipelines.rename'>,
    ): Promise<ResultOf<'pipelines.rename'>> =>
      mapErrors(async () => ({ saved: await store.rename(params.pipelineId, params.name) })),
    'pipelines.delete': (
      params: ParsedParamsOf<'pipelines.delete'>,
    ): Promise<ResultOf<'pipelines.delete'>> =>
      mapErrors(async () => {
        await store.delete(params.pipelineId);
        return {};
      }),
  };
}
