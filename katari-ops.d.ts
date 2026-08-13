/**
 * Katari の operation 引数型（**自動生成 — 直接編集しない**）。
 *
 * 生成元: src-tauri/src/ai/tools.rs + src-tauri/src/ai/mcp_server.rs
 * 再生成: pnpm run gen:ext-ops
 *
 * `katari.ops.invoke()` / `katari.edit()` に渡す op 名と引数がこの表で
 * 型付けされる。AI アシスタントが使うツールと同じ操作面なので、片方だけが
 * 古くなることはない。
 */

declare module "@katari/ext" {
  /** op 名 → 引数の型。 */
  export interface KatariOps {
    add_graph_node: {
      screen_id: string;
      function_id?: string;
      /** Node type as registered in `listNodeDefinitions()`. */
      node_type: string;
      x: number;
      y: number;
      props?: unknown;
    };
    add_screen: {
      parent_screen_id?: string;
      name?: string;
      pos?: Vec2;
    };
    add_screen_object: {
      screen_id: string;
      /** 0-based index path into the screen object tree (empty for root). */
      parent_path?: number[];
      /**
       * Object kind. `frame` is a container that can hold children; the rest
       * are leaf nodes.
       */
      kind: "frame" | "image" | "button" | "text" | "rectangle";
      pos?: Vec2;
      /**
       * Optional initial property patch (e.g. `{ name: "Logo", width: 200 }`).
       * Applied immediately after creation so the new object lands with the
       * caller's intended fields in a single tool call.
       */
      props?: unknown;
      /** Preview-only: when true, predict the change without persisting. */
      dry_run?: boolean;
    };
    align_objects: {
      screen_id: string;
      /** Object paths to align. Must share a common parent. */
      paths: number[][];
      axis: "left" | "right" | "center_x" | "top" | "bottom" | "center_y" | "distribute_x" | "distribute_y";
      dry_run?: boolean;
    };
    batch_apply_graph: {
      screen_id: string;
      function_id?: string;
      nodes: BatchNode[];
      edges: BatchEdge[];
      /**
       * `replace` (default): overwrite the entire graph with these nodes/edges.
       * `merge`: keep existing nodes/edges and add the new ones; local ids
       * must not collide with existing real ids.
       */
      apply_mode?: string;
      /** Auto-revert if any port mismatch / lint failure is detected. */
      strict?: boolean;
    };
    batch_apply_screen_objects: {
      screen_id: string;
      /**
       * Base parent path (empty = root). All `objects[]` entries are
       * inserted as children of this parent.
       */
      parent_path?: number[];
      objects: ObjectSpec[];
      /** Roll back to the pre-call state if any spec fails. Default true. */
      strict?: boolean;
    };
    connect_graph_edge: {
      screen_id: string;
      function_id?: string;
      from_node_id: string;
      from_port: string;
      to_node_id: string;
      to_port: string;
    };
    get_recent_changes: {
      /** Number of entries to return (default 10, capped at 50 by frontend). */
      limit?: number;
    };
    get_scene: {
      /** 0-based scene index. Use this for a single scene fetch. */
      scene_idx?: number;
      /**
       * Batch variant: multiple indices fetched in one call. Set this
       * instead of `scene_idx` when you need several scenes — avoids
       * wasting turns on repeated single-scene calls.
       */
      scene_idxs?: number[];
    };
    get_screen: {
      /** Screen identifier as shown in the project tree. */
      screen_id: string;
    };
    get_screen_graph: {
      screen_id: string;
      /** Optional script function id; omit for the root graph. */
      function_id?: string;
    };
    get_visual_bounds: {
      screen_id: string;
      path: number[];
    };
    graph_dsl_apply: {
      screen_id: string;
      function_id?: string;
      /** DSL source. See tool description for grammar. */
      source: string;
      apply_mode?: string;
      strict?: boolean;
    };
    insert_scene_step: {
      scene_idx: number;
      /** 0-based insertion index. Use `steps.len()` to append. */
      at: number;
      step: unknown;
    };
    instantiate_template: {
      template: "title_screen" | "branch_choice";
      /** Optional target screen. If omitted, a new screen is created. */
      screen_id?: string;
    };
    lint_screen_graph: {
      screen_id: string;
      function_id?: string;
    };
    list_assets: {
      /** Asset kind (ADR-0071). Omit to receive every kind at once. */
      category?: "image" | "sound" | "film" | "font" | "model" | "environment" | "other";
    };
    list_extension_commands: {
      // 引数なし
    };
    list_node_definitions: {
      /**
       * Optional substring filter (matches `type`, `label`, or `category`).
       * Empty / omitted returns the entire catalog — recommended for the
       * first call.
       */
      filter?: string;
      /**
       * Compact mode (default true): pins and properties are flattened
       * into short strings. Set false for the verbose object form when
       * the AI specifically needs labels / defaults that the compact
       * summary omits.
       */
      verbose?: boolean;
    };
    list_scenes: {
      // 引数なし
    };
    list_screens: {
      // 引数なし
    };
    redo: {
      // 引数なし
    };
    remove_graph_edge: {
      screen_id: string;
      function_id?: string;
      edge_id: string;
    };
    remove_graph_node: {
      screen_id: string;
      function_id?: string;
      node_id: string;
      /** If true, remove edges referencing this node too. Default true. */
      cascade_edges?: boolean;
    };
    remove_scene_step: {
      scene_idx: number;
      at: number;
    };
    remove_screen_object: {
      screen_id: string;
      path: number[];
      dry_run?: boolean;
    };
    run_extension_command: {
      /** Extension id, e.g. `com.example.bulk-rename`. */
      extension_id: string;
      /** Command id as declared in the extension manifest. */
      command_id: string;
    };
    screenshot_screen: {
      screen_id: string;
      /** Optional viewport width in pixels. Default 1280. */
      width?: number;
      /** Optional viewport height in pixels. Default 720. */
      height?: number;
    };
    set_scene_steps: {
      scene_idx: number;
      /** Replacement steps. Frontend regenerates `raw_script` afterwards. */
      steps: unknown;
    };
    set_screen_graph: {
      screen_id: string;
      function_id?: string;
      /** Full ScriptGraph JSON ({ nodes, edges }). */
      graph: unknown;
    };
    simulate_click: {
      screen_id: string;
      /**
       * Either the screen-tree path or the object id of the button. At least
       * one must be provided.
       */
      object_path?: number[];
      object_id?: string;
      function_id?: string;
    };
    simulate_runtime: {
      screen_id: string;
      /** Function id, or omit for the screen's root graph. */
      function_id?: string;
      /**
       * Pre-set values applied via `engine.setVariable` *before* BeginPlay.
       * Keys are variable names; values can be int / bool / string.
       */
      initial_variables?: unknown;
      /**
       * Number of `Event Tick` invocations to dispatch after BeginPlay
       * settles. Default 0.
       */
      ticks?: number;
      /** Hard cap on advance() iterations. Default 500, max 2000. */
      max_steps?: number;
      /**
       * Optional sequence of events to dispatch in order **after** BeginPlay
       * settles (and before the `ticks` Tick dispatches). Each entry is a
       * raw label name; `engine.dispatchEvent(label)` is called.
       * Common labels:
       * - `_g_tick_entry` — Tick (use `ticks` arg for repeated dispatch)
       * - `_g_subscribe_<node_id>` — Subscribe<T> (R3-style Observable consumer)
       * - custom labels declared in the graph
       */
      dispatch_events?: string[];
      /**
       * When true, automatically fire `_g_subscribe_<id>` whenever a watched
       * variable transitions (mirrors the rAF-based driver in production).
       * Default true.
       */
      auto_observe?: boolean;
      /**
       * Opt-in transition recording: list variable names to track. For each
       * step where one of these variables changes, an entry is added to
       * `variable_transitions` in the result. Empty/None disables — keeps
       * payload small for the common case.
       */
      watch_variables?: string[];
    };
    suggest_graph_completions: {
      screen_id: string;
      function_id?: string;
    };
    undo: {
      // 引数なし
    };
    update_graph_node: {
      screen_id: string;
      function_id?: string;
      node_id: string;
      /** Partial patch merged into the node (e.g. `{ "x": 100, "props": {...} }`). */
      patch: unknown;
    };
    update_scene_step: {
      scene_idx: number;
      at: number;
      /** Partial patch merged into the step (`{ params: {...}, kind: "..." }`). */
      patch: unknown;
    };
    update_screen_object: {
      screen_id: string;
      /** 0-based index path into the screen object tree. */
      path: number[];
      /** Partial patch applied via `applyScreenObjectPatch` on the frontend. */
      patch: unknown;
      dry_run?: boolean;
    };
    validate_scene: {
      scene_idx: number;
    };
  }

  /** 呼び出せる op 名。 */
  export type KatariOpName = keyof KatariOps;

  export interface BatchEdge {
    /**
     * `"<local_id>.<port_name>"` (e.g. `"btn.exec_out"`). The `local_id`
     * must reference a node defined in this batch (in merge mode it may
     * also reference an existing real id).
     */
    from: string;
    to: string;
  }

  export interface BatchNode {
    /**
     * Caller-chosen short id (e.g. `"btn"`, `"add"`). Resolved to a UUID
     * internally; only used to wire up edges within the same batch.
     */
    id: string;
    /**
     * Node type from `listNodeDefinitions()` (e.g. `button_pressed`,
     * `int_add`, `set_variable_int`).
     */
    node_type: string;
    x?: number;
    y?: number;
    /**
     * Optional inline props. Special key `object_name` is resolved to
     * `object_id` by name-matching against the screen's object tree.
     */
    props?: unknown;
  }

  export interface ObjectSpec {
    kind: "frame" | "image" | "button" | "text" | "rectangle";
    pos?: Vec2;
    /**
     * Property patch applied right after creation. Use this to set
     * `name`, `width`, `height`, `text`, `texture`, color fields, etc.
     */
    props?: unknown;
    /** Only valid when `kind: "frame"`. Recursively builds child objects. */
    children?: ObjectSpec[];
  }

  export interface Vec2 {
    x: number;
    y: number;
  }
}
