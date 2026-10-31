# Renderer plan

Updated 2026-10-31 by Codex, OpenAI's coding agent. Completed renderer work is recorded in [CHANGELOG.md](CHANGELOG.md), public contracts in [API](docs/api.md), and validation evidence in [Specification](docs/specification.md).

## Integration boundary

The 0.1.1 integration additions are implemented: typed selection transfer, pre-overlay mirroring, PNG metadata, texture allocation guards and the packaged worker transport. The release candidate is prepared locally; pushing and publishing remain on hold until requested.

The CPU inspection APIs required by pcbjs's beta.2/beta.3 plans are implemented: reusable scenes, focused and replayable cameras, visibility, accumulated translations, annotations and caller-rasterized labels, node appearance controls, merged-item selection geometry, depth/ID outputs, sharp edges and structured failures. Worker lifecycle and transport ship as a package entry; scheduling and recovery have an executable integration reference. There are no remaining CPU feature tasks from that inspection batch.

The renderer remains generic: nodes, opaque selection IDs, world-space geometry, cameras and pixels. pcbjs owns compiler references, GLB and selection-geometry export, millimetre/Z-up conversion, layer elevations, theme roles, camera presets, fonts, legends, revision identity, worker scheduling/caching and MCP/CLI transport. Static exported geometry is sufficient for the planned assembly/flex inspection; interactive animation and deformation are not requirements for this batch.

## Upstream acceptance gates

These are pcbjs integration work, not missing renderer APIs:

- Adapt the common shot specification to the implemented API. Export original item geometry alongside merged visible surfaces, preserve overlapping membership and rebuild IDs with each revision. The renderer accepts world-space vertices with optional translation anchors; it does not define a serialized glTF extension.
- Connect the production worker/session lifecycle to revision invalidation, queue limits, cancellation by termination and single-retry recovery. The packaged worker proves the transport contract, not the production service.
- Run compile/export/load/render/PNG/transport measurements through the actual shot/MCP entry point. `bench:inspection` measures existing exported boards and worker transport only. Its synthetic selection proxy is a mask-cost fixture, not an exporter accuracy result. Record real per-item geometry overhead and service memory before enabling all proxies by default.
- Observe the Linux/macOS/Windows Node 22/24 CI matrix after a push. Local checks cannot establish unexecuted remote results.

## Design priorities

Optimize for CPU correctness, throughput, memory efficiency and a clear generic API. GPU compatibility is not an acceptance criterion or an architectural constraint. Choose data layouts, algorithms and feature behavior for the CPU renderer and its actual consumers; do not retain abstractions solely to accommodate a possible GPU backend.

GPU support is not planned in the near future. Keep `experimental/webgpu` local and dormant, with its historical results on that branch. Synchronization, parity work and promotion are outside the active plan unless explicitly requested. A future GPU implementation must adapt to the CPU design, rather than require compromises in it.

The supported glTF subset and unsupported materials/deformation remain in Specification. They are explicit product limits, not an unbounded commitment to full glTF coverage before integration.
