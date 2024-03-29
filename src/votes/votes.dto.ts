import {
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { IsValidDate } from 'src/decorators/snapshots-date.decorator';
import { ApiProperty } from '@nestjs/swagger';

export class MSolVoteRecordDto {
  @IsString()
  @ApiProperty()
  tokenOwner: string;

  @IsString()
  @ApiProperty()
  validatorVoteAccount: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ type: String, nullable: true })
  amount: string | null;
}

export class VeMNDEVoteRecordDto {
  @IsString()
  @ApiProperty()
  tokenOwner: string;

  @IsString()
  @ApiProperty()
  validatorVoteAccount: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ type: String, nullable: true })
  amount: string | null;
}

export class MSolVoteRecordsDto {
  @ValidateNested()
  @ApiProperty({
    type: MSolVoteRecordDto,
    isArray: true,
  })
  records: MSolVoteRecordDto[];

  @IsDateString()
  @IsOptional()
  @ApiProperty({ type: String, nullable: true })
  mSolSnapshotCreatedAt: string | null;

  @IsDateString()
  @ApiProperty()
  voteRecordsCreatedAt: string;
}

export class SnapshotsIntervalDto {
  @IsOptional()
  @IsValidDate()
  @ApiProperty({ required: true, description: 'Start Date' })
  startDate: string;

  @IsOptional()
  @IsValidDate()
  @ApiProperty({ required: true, description: 'End Date' })
  endDate: string;
}

export class MSolVoteSnapshotsDto {
  @ValidateNested()
  @ApiProperty({
    type: MSolVoteRecordsDto,
    isArray: true,
  })
  snapshots: MSolVoteRecordsDto[];
}

export class VeMNDEVoteRecordsDto {
  @ValidateNested()
  @ApiProperty({
    type: VeMNDEVoteRecordDto,
    isArray: true,
  })
  records: VeMNDEVoteRecordDto[];

  @IsDateString()
  @IsOptional()
  @ApiProperty({ type: String, nullable: true })
  veMNDESnapshotCreatedAt: string | null;

  @IsDateString()
  @ApiProperty()
  voteRecordsCreatedAt: string;
}

export class VeMNDEVoteSnapshotsDto {
  @ValidateNested()
  @ApiProperty({
    type: VeMNDEVoteRecordsDto,
    isArray: true,
  })
  snapshots: VeMNDEVoteRecordsDto[];
}
