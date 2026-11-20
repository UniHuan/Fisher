import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsInt, IsString, Length, Max, Min } from 'class-validator';

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class RestrictUserDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 30,
    description: 'Restriction length in days; publishing is blocked until it expires',
    example: 3,
  })
  @IsInt()
  @Min(1)
  @Max(30)
  days!: number;

  @ApiProperty({
    description: 'Reason stored in the audit log',
    maxLength: 200,
    example: '重复违规',
  })
  @Transform(trimString)
  @IsString()
  @Length(1, 200)
  reason!: string;
}

export class BanUserDto {
  @ApiProperty({
    description: 'Reason stored in the audit log; content is removed with reason user_banned',
    maxLength: 200,
    example: '严重违规',
  })
  @Transform(trimString)
  @IsString()
  @Length(1, 200)
  reason!: string;
}
