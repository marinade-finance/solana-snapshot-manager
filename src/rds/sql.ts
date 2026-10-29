import { QuerySqlToken, ValueExpression, sql as slonikSql } from 'slonik';

// slonik 49 types unvalidated rows as unknown; keep them any as on slonik 33
type AnyRowSchema = {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly validate: (value: unknown) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly types?: { readonly input: any; readonly output: any };
  };
};

type UnsafeTag = (
  template: TemplateStringsArray,
  ...values: ValueExpression[]
) => QuerySqlToken<AnyRowSchema>;

export const sql: Omit<typeof slonikSql, 'unsafe'> & { unsafe: UnsafeTag } = {
  ...slonikSql,
  unsafe: slonikSql.unsafe as UnsafeTag,
};
