/**
 * IDGenerator generates unique identifiers.
 * At domain level, IDs are plain strings.
 * Implementations MUST use UUID v7 only (RFC 9562). Never UUID v4.
 * Implementations MUST use UUID v7 only (RFC 9562). Never UUID v4.
 */
export interface IDGenerator {
  newId(): string;
}
