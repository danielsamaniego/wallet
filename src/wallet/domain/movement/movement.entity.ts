export type MovementType = "deposit" | "withdrawal" | "transfer" | "hold_capture";

export class Movement {
  private readonly _id: string;
  private readonly _type: MovementType;
  private readonly _createdAt: number;

  private constructor() {
    this._id = "";
    this._type = "deposit";
    this._createdAt = 0;
  }

  static create(params: { id: string; type: MovementType; createdAt: number }): Movement {
    const m = new Movement();
    Object.assign(m, {
      _id: params.id,
      _type: params.type,
      _createdAt: params.createdAt,
    });
    return m;
  }
 
  static reconstruct(params: { id: string; type: MovementType; createdAt: number }): Movement {
    const m = new Movement();
    Object.assign(m, {
      _id: params.id,
      _type: params.type,
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
  get createdAt(): number {
    return this._createdAt;
  }
}
