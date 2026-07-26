import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";

// Not under `modules/`: that directory holds the domain modules named in
// docs/architecture/repository-structure.md, and liveness is an operational
// concern with no domain behind it.
@Module({ controllers: [HealthController] })
export class HealthModule {}
