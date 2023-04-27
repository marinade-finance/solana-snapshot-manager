#!/bin/bash

SQLITE="$1"

if [[ -z $SQLITE ]]
then
  echo "Usage: $0 <sqlite>"
  exit 1
fi

if ! [[ -f $SQLITE ]]
then
  echo "File does not exist: $SQLITE"
  exit 1
fi

<<<'
.echo on
create index token_account_mint on token_account(mint);
create index token_account_owner on token_account(owner);
' sqlite3 "$SQLITE"
