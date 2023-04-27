import { Module } from '@nestjs/common';
import { RdsModule } from 'src/rds/rds.module';
import { ParserService } from 'src/snapshot/parser.service';
import { SnapshotModule } from 'src/snapshot/snapshot.module';
import { SnapshotService } from 'src/snapshot/snapshot.service';
import { FiltersCommand } from './filters.cmd';
import { ParseCommand } from './parse.cmd';

@Module({
  imports: [SnapshotModule, RdsModule],
  providers: [ParseCommand, ParserService, SnapshotService, FiltersCommand],
})
export class CliModule {}
