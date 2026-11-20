import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsString, Length } from 'class-validator';

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class RemoveReportDto {
  @ApiProperty({
    description: 'Removal reason stored on the report and shown to the author',
    maxLength: 200,
    example: '违规下架',
  })
  @Transform(trimString)
  @IsString()
  @Length(1, 200)
  reason!: string;
}
