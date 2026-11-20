import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export const ABUSE_HANDLE_ACTIONS = ['remove', 'dismiss'] as const;

export type AbuseHandleAction = (typeof ABUSE_HANDLE_ACTIONS)[number];

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class HandleAbuseDto {
  @ApiProperty({
    enum: ABUSE_HANDLE_ACTIONS,
    description: 'remove takes the content down; dismiss keeps it unchanged',
    example: 'remove',
  })
  @IsIn(ABUSE_HANDLE_ACTIONS)
  action!: AbuseHandleAction;

  @ApiPropertyOptional({
    description: 'Handling note stored in the audit log and report reject_reason on removal',
    maxLength: 200,
    example: '确认广告引流',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @Length(1, 200)
  reason?: string;
}
