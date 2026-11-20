import { ApiProperty } from '@nestjs/swagger';
import { MODERATION_STATUS } from '@szfisher/shared';
import { AppUserDto } from './app-session-response.dto';

const NOTICE_STATUSES = [
  MODERATION_STATUS.MACHINE_REJECTED,
  MODERATION_STATUS.HUMAN_REJECTED,
  MODERATION_STATUS.REMOVED,
];

export class AppNoticeDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  report_id!: string;

  @ApiProperty({ enum: NOTICE_STATUSES })
  moderation_status!: string;

  @ApiProperty({ type: String, nullable: true, example: '广告引流' })
  reject_reason!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  audit_time!: string;
}

export class AppMeDto {
  @ApiProperty({ type: () => AppUserDto })
  user!: AppUserDto;

  @ApiProperty({ example: true })
  can_publish!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  restricted_until!: string | null;

  @ApiProperty({ type: [AppNoticeDto] })
  notices!: AppNoticeDto[];
}
