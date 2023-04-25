import { IsDateString, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MsolBalanceDto {
  @IsNumber()
  @ApiProperty()
  amount: number;

  @IsNumber()
  @ApiProperty()
  slot: number;

  @IsDateString()
  @ApiProperty()
  createdAt: string;
}
