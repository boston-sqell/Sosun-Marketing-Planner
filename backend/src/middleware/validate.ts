import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Express middleware factory that validates `req.body` against a Zod schema.
 * On success, replaces `req.body` with the parsed (whitelisted, coerced) output.
 * On failure, returns a 400 with structured validation errors.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = formatZodErrors(result.error);
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
      });
    }
    // Replace body with parsed/cleaned data — this is the whitelist effect.
    // Unknown keys are stripped (or rejected if .strict() is used on the schema).
    req.body = result.data;
    next();
  };
}

function formatZodErrors(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}
