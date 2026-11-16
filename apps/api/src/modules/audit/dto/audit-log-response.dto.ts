import { ApiProperty } from '@nestjs/swagger';

export class AuditLogItemDto {
  @ApiProperty({ example: '01HX0000000000000000000000' })
  log_id!: string;

  @ApiProperty({ example: '01HX0000000000000000000001' })
  admin_id!: string;

  @ApiProperty({ example: 'dictionary.update' })
  action!: string;

  @ApiProperty({ example: 'dictionary' })
  entity_type!: string;

  @ApiProperty({ nullable: true, example: 'poi_type:food', type: String })
  entity_id!: string | null;

  @ApiProperty({ type: Object, additionalProperties: true, nullable: true })
  before_json!: Record<string, unknown> | null;

  @ApiProperty({ type: Object, additionalProperties: true, nullable: true })
  after_json!: Record<string, unknown> | null;

  @ApiProperty({ nullable: true, example: '203.0.113.10', type: String })
  ip!: string | null;

  @ApiProperty({ nullable: true, example: 'req_01HX0000000000000000000000', type: String })
  request_id!: string | null;

  @ApiProperty({ nullable: true, example: 'szfisher-admin/1.0.0', type: String })
  user_agent!: string | null;

  @ApiProperty({ example: '2026-11-16T08:00:00.000Z' })
  created_at!: string;
}

export class AuditLogPageDto {
  @ApiProperty({ type: () => [AuditLogItemDto] })
  items!: AuditLogItemDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  page_size!: number;

  @ApiProperty({ example: 1 })
  total!: number;

  @ApiProperty({ example: false })
  has_more!: boolean;
}
