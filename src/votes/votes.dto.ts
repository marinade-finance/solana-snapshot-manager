import {
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
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

export class MSolVoteSnapshots {
  @ValidateNested()
  @ApiProperty({
    type: MSolVoteRecordsDto,
    isArray: true,
  })
  snapshots: MSolVoteRecordsDto[];
}
