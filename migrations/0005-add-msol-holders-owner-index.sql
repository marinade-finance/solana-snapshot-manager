CREATE INDEX CONCURRENTLY IF NOT EXISTS msol_holders_owner_snapshot_id
    ON msol_holders (owner, snapshot_id);
