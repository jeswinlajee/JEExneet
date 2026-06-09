import { supabase } from './supabase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: supabase.auth.getUser().then(({ data }) => data.user?.id).catch(() => null),
      email: supabase.auth.getUser().then(({ data }) => data.user?.email).catch(() => null),
    },
    operationType,
    path
  }
  console.error('Database Operation Failed: ', JSON.stringify(errInfo));
  if (process.env.NODE_ENV !== 'production') {
    console.error(`[DB_ERR] ${operationType} on ${path}: ${errInfo.error}`);
  }
  throw new Error(JSON.stringify(errInfo));
}

export const removeUndefined = (obj: any): any => {
  if (obj === null || typeof obj !== 'object' || obj instanceof Date) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.filter(item => item !== undefined).map(removeUndefined);
  }

  const newObj: any = {};
  Object.keys(obj).forEach(key => {
    if (obj[key] !== undefined) {
      newObj[key] = removeUndefined(obj[key]);
    }
  });
  return newObj;
};
