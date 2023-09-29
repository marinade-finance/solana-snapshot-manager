import { IsArray, IsDateString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsValidDate } from 'src/decorators/snapshots-date.decorator';

export class MsolBalanceDto {
  @IsNumber()
  @ApiProperty()
  amount: string;

  @IsNumber()
  @ApiProperty()
  slot: number;

  @IsDateString()
  @ApiProperty()
  createdAt: string;
}

export class VeMNDEBalanceDto {
  @IsNumber()
  @ApiProperty()
  amount: string;

  @IsNumber()
  @ApiProperty()
  slot: number;

  @IsDateString()
  @ApiProperty()
  createdAt: string;
}

export class NativeStakeBalanceDto {
  @IsNumber()
  @ApiProperty()
  amount: string;

  @IsNumber()
  @ApiProperty()
  slot: number;

  @IsDateString()
  @ApiProperty()
  createdAt: string;

  @IsDateString()
  @ApiProperty()
  snapshotCreatedAt: string;
}

export class AllNativeStakeBalancesDto {
  [owner: string]: NativeStakeBalanceDto[];
}

export class StakerBalancesDto {
  @ApiProperty()
  owner: string;

  @ApiProperty()
  @IsArray()
  balances: StakeBalanceDto[];
}

export class StakeBalanceDto {
  @IsNumber()
  @ApiProperty()
  liquid_amount: string;

  @IsNumber()
  @ApiProperty()
  native_amount: string;

  @IsNumber()
  @ApiProperty()
  slot: number;

  @IsDateString()
  @ApiProperty()
  createdAt: string;
}

export class SnapshotsIntervalDto {
  @IsOptional()
  @IsValidDate()
  startDate: string;

  @IsOptional()
  @IsValidDate()
  endDate: string;
}
