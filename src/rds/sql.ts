import { QuerySqlToken, ValueExpression, sql as slonikSql } from 'slonik';

// Structural stand-in for a schema whose rows are `any`. slonik 49 types the
// rows of `sql.unsafe` (no validation) as `unknown`; the queries here read
// columns straight off untyped rows, as they did on slonik 33.
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
