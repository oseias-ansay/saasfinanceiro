import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';
import { AppError } from '../lib/errors.js';

type Target = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, target: Target = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      return next(
        new AppError(422, 'Dados inválidos', 'validation_error', result.error.flatten().fieldErrors),
      );
    }
    // Substitui pelo valor já convertido (datas, números, defaults).
    req[target] = result.data as never;
    next();
  };
}
