export type MovementType =
  | "deposit"
  | "withdrawal"
  | "transfer"
  | "hold_capture"
  | "adjustment"
  | "charge";

export class Movement {
  private readonly _id: string;
  private readonly _type: MovementType;
  private readonly _reason: string | null;
  private readonly _createdAt: number;

  private constructor() {
    this._id = "";
    this._type = "deposit";
    this._reason = null;
    this._createdAt = 0;
  }

  static create(params: {
    id: string;
    type: MovementType;
    reason?: string | null;
    createdAt: number;
  }): Movement {
    const m = new Movement();
    Object.assign(m, {
      _id: params.id,
      _type: params.type,
      _reason: params.reason ?? null,
      _createdAt: params.createdAt,
    });
    return m;
  }

  static reconstruct(params: {
    id: string;
    type: MovementType;
    reason: string | null;
    createdAt: number;
  }): Movement {
    const m = new Movement();
    Object.assign(m, {
      _id: params.id,
      _type: params.type,
      _reason: params.reason,
      _createdAt: params.createdAt,
    });
    return m;
  }

  get id(): string {
    return this._id;
  }
  get type(): MovementType {
    return this._type;
  }
  get reason(): string | null {
    return this._reason;
  }
  get createdAt(): number {
    return this._createdAt;
  }
}
