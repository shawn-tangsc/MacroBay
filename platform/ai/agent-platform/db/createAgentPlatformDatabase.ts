import { DatabaseSync } from 'node:sqlite'

type AgentPlatformMigration = {
  id: string
  up: string | ((connection: DatabaseSync) => void)
}

const migrations: AgentPlatformMigration[] = [
  {
    id: '0001_agent_platform_core',
    up: `
      create table if not exists agent_platform_migrations (
        id text primary key,
        applied_at text not null
      );

      create table if not exists agent_entities (
        id text primary key,
        type text not null,
        name text not null,
        description text,
        instructions text,
        model text,
        model_name text,
        plan_model text,
        small_model text,
        mcps_json text not null,
        disabled_tools_json text not null,
        configuration_json text,
        order_key text not null,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_agent_entities_order
        on agent_entities(order_key, id);

      create index if not exists idx_agent_entities_updated
        on agent_entities(updated_at desc, id);

      create table if not exists agent_workspaces (
        id text primary key,
        name text not null,
        path text not null,
        type text not null,
        order_key text not null,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_agent_workspaces_type_order
        on agent_workspaces(type, order_key, id);

      create index if not exists idx_agent_workspaces_path
        on agent_workspaces(path);

      create table if not exists agent_sessions (
        id text primary key,
        agent_id text,
        name text not null,
        description text,
        workspace_id text not null,
        trace_id text,
        order_key text not null,
        created_at text not null,
        updated_at text not null,
        foreign key (workspace_id) references agent_workspaces(id)
      );

      create index if not exists idx_agent_sessions_agent_order
        on agent_sessions(agent_id, order_key, id);

      create table if not exists agent_session_messages (
        id text primary key,
        session_id text not null,
        role text not null,
        data_json text not null,
        searchable_text text not null,
        status text not null,
        model_id text,
        model_snapshot_json text,
        stats_json text,
        runtime_resume_token text,
        created_at text not null,
        updated_at text not null,
        foreign key (session_id) references agent_sessions(id)
      );

      create index if not exists idx_agent_session_messages_session_created
        on agent_session_messages(session_id, created_at desc, id desc);

      create virtual table if not exists agent_session_messages_fts
        using fts5(message_id UNINDEXED, session_id UNINDEXED, searchable_text);
    `
  },
  {
    id: '0002_agent_platform_state_entries',
    up: `
      create table if not exists agent_session_pins (
        id text primary key,
        session_id text not null unique,
        created_at text not null,
        foreign key (session_id) references agent_sessions(id)
      );

      create index if not exists idx_agent_session_pins_created
        on agent_session_pins(created_at desc, id desc);

      create table if not exists agent_platform_state_entries (
        key text primary key,
        value_json text not null,
        updated_at text not null
      );

      create table if not exists agent_active_selection (
        id integer primary key check (id = 1),
        active_agent_id text,
        active_session_id text,
        updated_at text not null
      );
    `
  },
  {
    id: '0003_agent_task_read_models',
    up: `
      create table if not exists agent_tasks (
        id text primary key,
        agent_id text not null,
        name text not null,
        prompt text not null,
        trigger_json text not null,
        catch_up_policy_json text,
        timeout_minutes integer not null,
        workspace_json text not null,
        channel_ids_json text,
        next_run text,
        last_run text,
        enabled integer not null,
        status text not null,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_agent_tasks_agent_created
        on agent_tasks(agent_id, created_at desc, id asc);

      create table if not exists agent_task_run_logs (
        id text primary key,
        schedule_id text not null,
        session_id text,
        started_at text not null,
        duration_ms integer not null,
        status text not null,
        result text,
        error text
      );

      create index if not exists idx_agent_task_run_logs_schedule_started
        on agent_task_run_logs(schedule_id, started_at desc, id asc);
    `
  },
  {
    id: '0004_agent_channel_read_models',
    up: `
      create table if not exists agent_channels (
        id text primary key,
        type text not null,
        name text not null,
        agent_id text,
        session_id text,
        workspace_json text not null,
        config_json text not null,
        is_active integer not null,
        active_chat_ids_json text,
        permission_mode text,
        created_at text not null,
        updated_at text not null
      );

      create index if not exists idx_agent_channels_agent_updated
        on agent_channels(agent_id, updated_at desc, id asc);

      create index if not exists idx_agent_channels_session
        on agent_channels(session_id, id asc);

      create table if not exists agent_channel_task_subscriptions (
        channel_id text not null,
        task_id text not null,
        primary key (channel_id, task_id)
      );

      create index if not exists idx_agent_channel_task_subscriptions_task
        on agent_channel_task_subscriptions(task_id, channel_id);
    `
  },
  {
    id: '0005_agent_workspace_query_indexes',
    up: `
      create index if not exists idx_agent_entities_order
        on agent_entities(order_key, id);

      create index if not exists idx_agent_entities_updated
        on agent_entities(updated_at desc, id);

      create index if not exists idx_agent_workspaces_type_order
        on agent_workspaces(type, order_key, id);

      create index if not exists idx_agent_workspaces_path
        on agent_workspaces(path);
    `
  },
  {
    id: '0006_agent_active_selection_table',
    up: `
      create table if not exists agent_active_selection (
        id integer primary key check (id = 1),
        active_agent_id text,
        active_session_id text,
        updated_at text not null
      );
    `
  },
  {
    id: '0007_agent_mcp_read_models',
    up: `
      create table if not exists agent_mcp_servers (
        id text primary key,
        name text not null,
        type text,
        is_active integer not null,
        sort_order integer,
        install_source text,
        metadata_json text not null,
        created_at text,
        updated_at text
      );

      create index if not exists idx_agent_mcp_servers_order
        on agent_mcp_servers(sort_order, name, id);

      create table if not exists agent_mcp_tools (
        server_id text not null,
        tool_id text not null,
        name text not null,
        description text,
        input_schema_json text,
        sort_index integer not null,
        primary key (server_id, tool_id),
        foreign key (server_id) references agent_mcp_servers(id) on delete cascade
      );

      create index if not exists idx_agent_mcp_tools_server_order
        on agent_mcp_tools(server_id, sort_index, tool_id);

      create table if not exists agent_mcp_runtime_status (
        server_id text primary key,
        state text not null,
        message text,
        last_checked_at integer not null,
        foreign key (server_id) references agent_mcp_servers(id) on delete cascade
      );
    `
  },
  {
    id: '0008_agent_skill_read_models',
    up: `
      create table if not exists agent_skills (
        id text primary key,
        name text not null,
        description text,
        folder_name text not null,
        source text not null,
        source_url text,
        namespace text,
        author text,
        source_tags_json text not null,
        content_hash text not null,
        is_enabled integer not null,
        sort_index integer not null,
        created_at text not null,
        updated_at text not null
      );

      create unique index if not exists idx_agent_skills_folder_name
        on agent_skills(folder_name);

      create index if not exists idx_agent_skills_order
        on agent_skills(sort_index, id);

      create table if not exists agent_skill_bindings (
        agent_id text not null,
        skill_id text not null,
        is_enabled integer not null,
        primary key (agent_id, skill_id),
        foreign key (skill_id) references agent_skills(id) on delete cascade
      );

      create index if not exists idx_agent_skill_bindings_agent
        on agent_skill_bindings(agent_id, skill_id);

      create index if not exists idx_agent_skill_bindings_skill
        on agent_skill_bindings(skill_id, agent_id);
    `
  },
  {
    // Task lifecycle state is required before the wider Task 4 audit/read-model work.
    id: '0009_agent_task_automation_full_experience',
    up: `
      alter table agent_tasks add column revision integer not null default 1;
      alter table agent_tasks add column pause_reason text;
      alter table agent_tasks add column failure_reset_at text;
      alter table agent_tasks add column provenance_json text;
    `
  },
  {
    id: '0010_agent_task_automation_history_read_models',
    up: `
      alter table agent_task_run_logs add column agent_id text;
      alter table agent_task_run_logs add column task_name_snapshot text;
      alter table agent_task_run_logs add column terminal_reason text;
      alter table agent_task_run_logs add column result_preview text;
      alter table agent_task_run_logs add column result_hash text;
      alter table agent_task_run_logs add column result_char_count integer;
      alter table agent_task_run_logs add column usage_json text;
      alter table agent_task_run_logs add column delivery_summary_json text;

      update agent_task_run_logs set result_preview = result where result_preview is null and result is not null;
      update agent_task_run_logs
      set agent_id = (select agent_id from agent_tasks where agent_tasks.id = agent_task_run_logs.schedule_id),
          task_name_snapshot = (select name from agent_tasks where agent_tasks.id = agent_task_run_logs.schedule_id)
      where exists (select 1 from agent_tasks where agent_tasks.id = agent_task_run_logs.schedule_id);

      create index if not exists idx_agent_task_run_logs_task_started
        on agent_task_run_logs(schedule_id, started_at desc, id asc);

      create index if not exists idx_agent_tasks_status_next_run
        on agent_tasks(status, next_run, id);

      create table if not exists agent_task_delivery_attempts (
        id text primary key,
        run_log_id text not null,
        task_id text not null,
        agent_id text not null,
        task_name_snapshot text not null,
        channel_id text not null,
        target_hash text,
        status text not null,
        attempt_number integer not null,
        started_at text not null,
        completed_at text,
        error_code text
      );

      create index if not exists idx_agent_task_delivery_attempts_run_started
        on agent_task_delivery_attempts(run_log_id, started_at desc, id asc);

      create table if not exists agent_task_mutation_audits (
        id text primary key,
        task_id text,
        agent_id text not null,
        task_name_snapshot text,
        action text not null,
        actor_json text not null,
        request_hash text not null,
        result_revision integer,
        created_at text not null,
        outcome text not null,
        error_code text
      );

      create index if not exists idx_agent_task_mutation_audits_task_created
        on agent_task_mutation_audits(task_id, created_at desc, id asc);

      create index if not exists idx_agent_task_mutation_audits_agent_created
        on agent_task_mutation_audits(agent_id, created_at desc, id asc);

      create table if not exists agent_task_automation_maintenance (
        key text primary key,
        value_json text not null,
        updated_at text not null
      );
    `
  },
  {
    id: '0002_agent_product_tool_provider',
    up: `
      create table if not exists agent_product_tool_package_bindings (
        agent_id text not null,
        product_id text not null,
        permission_mode text not null,
        updated_at text not null,
        primary key (agent_id, product_id)
      );

      create index if not exists idx_agent_product_tool_package_bindings_agent
        on agent_product_tool_package_bindings(agent_id, product_id);

      create table if not exists agent_product_tool_call_traces (
        tool_call_id text primary key,
        product_id text not null,
        tool_name text not null,
        handler_id text not null,
        schema_version integer not null,
        consumer_product_id text,
        agent_id text not null,
        agent_session_id text not null,
        as_of text,
        input_hash text not null,
        output_hash text,
        started_at text not null,
        completed_at text,
        duration_ms integer,
        status text not null,
        error_code text,
        result_size_bytes integer
      );

      create index if not exists idx_agent_product_tool_call_traces_session_started
        on agent_product_tool_call_traces(agent_session_id, started_at);

      create index if not exists idx_agent_product_tool_call_traces_product_tool_started
        on agent_product_tool_call_traces(product_id, tool_name, started_at);

      create index if not exists idx_agent_product_tool_call_traces_consumer_started
        on agent_product_tool_call_traces(consumer_product_id, started_at);
    `
  },
  {
    // C03 keeps legacy columns only long enough for the startup reconciler to scrub them.
    id: '0011_channel_secure_migration',
    up: `
      create table agent_channels_c03 (
        id text primary key,
        type text not null,
        name text not null,
        agent_id text,
        workspace_json text,
        public_config_json text,
        credential_ref text,
        credential_revision integer,
        requested_enabled integer not null default 0,
        migration_state text not null default 'legacy',
        migration_error_code text,
        legacy_session_state text,
        created_at text not null,
        updated_at text not null,
        config_json text,
        session_id text,
        is_active integer,
        active_chat_ids_json text,
        permission_mode text
      );

      insert into agent_channels_c03 (
        id, type, name, agent_id, workspace_json, created_at, updated_at,
        config_json, session_id, is_active, active_chat_ids_json, permission_mode
      ) select
        id, type, name, agent_id, workspace_json, created_at, updated_at,
        config_json, session_id, is_active, active_chat_ids_json, permission_mode
      from agent_channels;

      drop table agent_channels;
      alter table agent_channels_c03 rename to agent_channels;

      create index idx_agent_channels_agent_updated
        on agent_channels(agent_id, updated_at desc, id asc);

      create index idx_agent_channels_session
        on agent_channels(session_id, id asc);

      create index idx_agent_channels_migration_state
        on agent_channels(migration_state, updated_at asc, id asc);

      create table channel_credential_migrations (
        id text primary key,
        channel_id text not null,
        purpose text not null,
        source_fingerprint text not null,
        fingerprint_key_id text not null,
        credential_ref text not null,
        migration_permit text not null,
        state text not null,
        attempt_count integer not null default 0,
        last_error_code text,
        created_at text not null,
        updated_at text not null,
        unique(channel_id, purpose, source_fingerprint),
        unique(credential_ref)
      );

      create index idx_channel_credential_migrations_state
        on channel_credential_migrations(state, updated_at asc, id asc);

      create table channel_legacy_discovery_archives (
        channel_id text primary key,
        archive_ref text not null unique,
        candidate_count integer not null,
        state text not null,
        expires_at text not null,
        created_at text not null,
        updated_at text not null
      );

      create index idx_channel_legacy_discovery_archives_expires
        on channel_legacy_discovery_archives(expires_at asc, channel_id asc);
    `
  },
  {
    // Channel inbound data never reuses legacy agent_channels fields or AgentStore state.
    id: '0012_channel_reliable_inbound',
    up: `
      create table channel_runtime_generations (
        channel_id text primary key,
        generation integer not null,
        lifecycle_state text not null,
        updated_at text not null
      );

      create table channel_conversations (
        id text primary key,
        channel_id text not null,
        conversation_key_ciphertext blob not null,
        conversation_key_ref text not null,
        conversation_key_revision integer not null,
        conversation_key_hash text not null,
        conversation_kind text not null,
        agent_session_id text not null unique,
        created_at text not null,
        updated_at text not null,
        unique(channel_id, conversation_key_hash)
      );

      create index idx_channel_conversations_channel_updated
        on channel_conversations(channel_id, updated_at desc, id asc);

      create table channel_conversation_session_operations (
        channel_id text not null,
        conversation_key_hash text not null,
        operation_id text not null,
        generation integer not null,
        agent_id text not null,
        created_at text not null,
        primary key (channel_id, conversation_key_hash)
      );

      create table channel_inbound_admission_reservations (
        id text primary key,
        channel_id text not null,
        generation integer not null,
        created_at text not null,
        expires_at text not null
      );

      create index idx_channel_inbound_admission_reservations_channel
        on channel_inbound_admission_reservations(channel_id, generation, expires_at asc, id asc);

      create table channel_allow_policies (
        id text primary key,
        channel_id text not null,
        subject_type text not null,
        subject_key_ciphertext blob not null,
        subject_key_ref text not null,
        subject_key_revision integer not null,
        subject_key_hash text not null,
        conversation_kind text,
        created_at text not null,
        unique(channel_id, subject_type, subject_key_hash, conversation_kind)
      );

      create index idx_channel_allow_policies_match
        on channel_allow_policies(channel_id, subject_type, subject_key_hash, conversation_kind);

      create table channel_delivery_targets (
        id text primary key,
        channel_id text not null,
        conversation_id text not null,
        enabled integer not null default 0,
        created_at text not null,
        updated_at text not null,
        unique(channel_id, conversation_id)
      );

      create index idx_channel_delivery_targets_enabled
        on channel_delivery_targets(channel_id, enabled, updated_at desc, id asc);

      create table channel_receipts (
        id text primary key,
        channel_id text not null,
        provider_event_key_ciphertext blob not null,
        provider_event_key_ref text not null,
        provider_event_key_revision integer not null,
        provider_event_key_hash text not null,
        status text not null,
        generation integer not null,
        created_at text not null,
        updated_at text not null,
        unique(channel_id, provider_event_key_hash)
      );

      create index idx_channel_receipts_channel_status_created
        on channel_receipts(channel_id, status, created_at asc, id asc);

      create table channel_inbound_work_items (
        id text primary key,
        receipt_id text not null unique,
        channel_id text not null,
        conversation_id text not null,
        dispatch_id text not null unique,
        payload_ciphertext blob not null,
        payload_key_ref text not null,
        payload_key_revision integer not null,
        status text not null,
        lease_token text,
        lease_expires_at text,
        attempt_count integer not null default 0,
        created_at text not null,
        updated_at text not null
      );

      create index idx_channel_inbound_work_items_recovery
        on channel_inbound_work_items(channel_id, status, lease_expires_at asc, id asc);

      create table channel_runtime_audits (
        id text primary key,
        channel_id text not null,
        generation integer,
        code text not null,
        created_at text not null
      );

      create index idx_channel_runtime_audits_channel_created
        on channel_runtime_audits(channel_id, created_at desc, id asc);
    `
  },
  {
    // Delivery ledger is metadata-only; content and provider keys remain cipher-protected at the service edge.
    id: '0013_channel_unified_delivery',
    up: `
      create table channel_delivery_attempts (
        id text primary key,
        channel_id text not null,
        agent_id text not null,
        conversation_id text not null,
        source_type text not null,
        source_hash text not null,
        idempotency_key text not null,
        status text not null,
        attempt_count integer not null default 0,
        send_owner_token text,
        send_owner_generation integer,
        send_lease_expires_at text,
        send_revision integer not null default 0,
        stable_error_code text,
        created_at text not null,
        updated_at text not null,
        completed_at text,
        unique(channel_id, conversation_id, source_type, source_hash)
      );

      create index idx_channel_delivery_attempts_cleanup
        on channel_delivery_attempts(channel_id, status, completed_at asc, id asc);

      create table channel_delivery_audits (
        id text primary key,
        channel_id text not null,
        attempt_id text,
        code text not null,
        created_at text not null
      );

      create index idx_channel_delivery_audits_cleanup
        on channel_delivery_audits(channel_id, created_at asc, id asc);
    `
  },
  {
    // Management operations retain only known vault reservations and stable audit metadata.
    id: '0014_channel_management_workspace',
    up: `
      create table channel_management_operations (
        id text primary key,
        channel_id text not null,
        purpose text not null,
        credential_ref text,
        source_fingerprint text,
        fingerprint_key_id text,
        operation_permit text,
        expected_revision integer,
        state text not null,
        stable_error_code text,
        created_at text not null,
        updated_at text not null
      );

      create index idx_channel_management_operations_state
        on channel_management_operations(state, updated_at asc, id asc);

      create table channel_management_audits (
        id text primary key,
        channel_id text not null,
        actor_id text not null,
        action text not null,
        code text,
        summary_json text not null,
        created_at text not null
      );

      create index idx_channel_management_audits_channel_created
        on channel_management_audits(channel_id, created_at desc, id asc);
    `
  },
  {
    // A deleted Channel ID is never reusable: C03 rows lack foreign-key cascades by design.
    id: '0015_channel_management_delete_isolation',
    up: `
      alter table agent_channels add column credential_health text not null default 'missing';

      alter table channel_management_operations add column payload_key_refs_json text not null default '[]';

      alter table channel_management_operations add column legacy_migrations_json text not null default '[]';

      update agent_channels
      set credential_health = case when credential_ref is null then 'missing' else 'unavailable' end;

      create table channel_management_tombstones (
        channel_id text primary key,
        deleted_at text not null
      );

      create index idx_channel_management_tombstones_deleted
        on channel_management_tombstones(deleted_at asc, channel_id asc);
    `
  },
  {
    // Telegram polling stores only the next opaque update number and safe operational metadata.
    id: '0016_telegram_release_a_runtime',
    up: `
      create table channel_telegram_offsets (
        channel_id text primary key,
        next_update_id integer not null default 0,
        updated_at text not null
      );

      create table channel_adapter_acceptance_evidence (
        adapter_type text primary key,
        evidence_json text not null,
        recorded_at text not null,
        recorded_by text not null
      );

      create table channel_telegram_runtime_audits (
        id text primary key,
        channel_id text not null,
        code text not null,
        created_at text not null
      );

      create index idx_channel_telegram_runtime_audits_channel_created
        on channel_telegram_runtime_audits(channel_id, created_at desc, id asc);
    `
  },
  {
    // A durable token prevents a stale enable/handshake from changing a newer lifecycle owner.
    id: '0017_telegram_lifecycle_owners',
    up: `
      create table channel_telegram_lifecycle_operations (
        channel_id text primary key,
        owner_token text not null,
        purpose text not null,
        generation integer,
        created_at text not null,
        updated_at text not null
      );
    `
  },
  {
    // Credential writes are also bound to the mutation that reserved their known Vault ref.
    id: '0018_channel_management_operation_owners',
    up: `
      alter table channel_management_operations add column lifecycle_owner_token text;

      create index idx_channel_management_operations_owner
        on channel_management_operations(channel_id, lifecycle_owner_token, state);
    `
  },
  {
    // Delete recovery retains only capability-bound refs for an in-flight credential mutation.
    id: '0019_channel_management_vault_compensation',
    up: `
      alter table channel_management_operations add column credential_cleanup_refs_json text not null default '[]';
    `
  },
  {
    // A monotonic mutation epoch prevents a stale Vault result from overtaking a later credential intent.
    id: '0020_channel_management_mutation_epochs',
    up: `
      alter table agent_channels add column mutation_epoch integer not null default 0;
      alter table channel_management_operations add column mutation_epoch integer;

      create index idx_channel_management_operations_epoch
        on channel_management_operations(channel_id, mutation_epoch, state);
    `
  },
  {
    // Evidence is versioned so an old complete smoke can never re-enable a superseded adapter.
    id: '0021_channel_adapter_evidence_ledger',
    up: `
      create table channel_adapter_acceptance_evidence_versions (
        adapter_type text not null,
        adapter_version text not null,
        evidence_json text not null,
        recorded_at text not null,
        recorded_by text not null,
        revoked_at text,
        superseded_at text,
        primary key (adapter_type, adapter_version)
      );

      create index idx_channel_adapter_evidence_versions_active
        on channel_adapter_acceptance_evidence_versions(adapter_type, revoked_at, superseded_at);

      create table channel_adapter_acceptance_current (
        adapter_type text primary key,
        adapter_version text not null,
        updated_at text not null,
        foreign key (adapter_type, adapter_version)
          references channel_adapter_acceptance_evidence_versions(adapter_type, adapter_version)
      );
    `
  },
  {
    // Slack retains only cursor metadata and stable audit codes; Socket Mode envelopes stay in memory.
    id: '0022_slack_release_b_runtime',
    up: `
      create table channel_slack_runtime_state (
        channel_id text primary key,
        generation integer not null,
        last_event_id_hash text,
        reconnect_cursor text,
        updated_at text not null
      );

      create index idx_channel_slack_runtime_state_updated
        on channel_slack_runtime_state(updated_at asc, channel_id asc);

      create table channel_slack_runtime_audits (
        id text primary key,
        channel_id text not null,
        code text not null,
        created_at text not null
      );

      create index idx_channel_slack_runtime_audits_channel_created
        on channel_slack_runtime_audits(channel_id, created_at desc, id asc);
    `
  },
  {
    // Lark keeps only generation-bound opaque event metadata; payloads remain in encrypted C03 work items.
    id: '0023_lark_release_c_runtime',
    up: `
      create table channel_lark_runtime_state (
        channel_id text primary key,
        generation integer not null,
        last_event_id_hash text,
        updated_at text not null
      );

      create index idx_channel_lark_runtime_state_updated
        on channel_lark_runtime_state(updated_at asc, channel_id asc);

      create table channel_lark_runtime_audits (
        id text primary key,
        channel_id text not null,
        code text not null,
        created_at text not null
      );

      create index idx_channel_lark_runtime_audits_channel_created
        on channel_lark_runtime_audits(channel_id, created_at desc, id asc);
    `
  },
  {
    // QQ retains only generation-bound sequence metadata and stable audit codes; session material remains Vault-only.
    id: '0024_qq_release_d_runtime',
    up: `
      create table channel_qq_gateway_state (
        channel_id text primary key,
        generation integer not null,
        last_sequence integer not null default 0,
        session_ref text,
        session_revision integer,
        updated_at text not null
      );

      create index idx_channel_qq_gateway_state_generation_updated
        on channel_qq_gateway_state(generation, updated_at asc, channel_id asc);

      create table channel_qq_runtime_audits (
        id text primary key,
        channel_id text not null,
        code text not null,
        created_at text not null
      );

      create index idx_channel_qq_runtime_audits_channel_created
        on channel_qq_runtime_audits(channel_id, created_at desc, id asc);
    `
  },
  {
    // Discord Release E retains only generation-bound resume references and stable audit codes.
    id: '0025_discord_release_e_runtime',
    up: `
      create table channel_discord_gateway_state (
        channel_id text primary key,
        generation integer not null,
        last_sequence integer not null default 0,
        session_ref text,
        session_revision integer,
        updated_at text not null
      );

      create index idx_channel_discord_gateway_state_generation_updated
        on channel_discord_gateway_state(generation, updated_at asc, channel_id asc);

      create table channel_discord_runtime_audits (
        id text primary key,
        channel_id text not null,
        code text not null,
        created_at text not null
      );

      create index idx_channel_discord_runtime_audits_channel_created
        on channel_discord_runtime_audits(channel_id, created_at desc, id asc);
    `
  },
  {
    // WeChat Release F stores only QR enrollment status and opaque cursor/context references.
    id: '0026_wechat_release_f_enrollment',
    up: `
      create table channel_wechat_qr_enrollments (
        operation_id text primary key,
        channel_id text not null,
        state text not null,
        context_ref text,
        context_revision integer,
        expires_at text not null,
        updated_at text not null
      );
      create unique index idx_channel_wechat_qr_enrollments_active
        on channel_wechat_qr_enrollments(channel_id) where state = 'pending';
      create index idx_channel_wechat_qr_enrollments_expiry
        on channel_wechat_qr_enrollments(expires_at asc, operation_id asc);
      create index idx_channel_wechat_qr_enrollments_terminal_cleanup
        on channel_wechat_qr_enrollments(state, updated_at asc, operation_id asc);

      create table channel_wechat_poll_state (
        channel_id text primary key,
        generation integer not null,
        next_cursor text,
        context_ref text,
        context_revision integer,
        updated_at text not null
      );
      create index idx_channel_wechat_poll_state_generation_updated
        on channel_wechat_poll_state(generation, updated_at asc, channel_id asc);

      create table channel_wechat_runtime_audits (
        id text primary key,
        channel_id text not null,
        code text not null,
        created_at text not null
      );
      create index idx_channel_wechat_runtime_audits_channel_created
        on channel_wechat_runtime_audits(channel_id, created_at desc, id asc);
    `
  },
  {
    // One row per adapter key. Every runtime query joins this projection instead of naming an adapter.
    id: '0027_channel_adapter_support',
    up: `
      create table channel_adapter_support (
        adapter_key text primary key
          check (adapter_key in ('telegram','slack','lark','qq','discord','wechat')),
        status text not null
          check (status in ('supported','blocked')),
        adapter_version text not null,
        evidence_recorded_at text,
        updated_at text not null
      );
    `
  },
  {
    // A deleted Agent session must not leave a channel bound to a missing session.
    id: '0028_channel_conversation_session_integrity',
    up: `
      create table channel_conversations_v2 (
        id text primary key,
        channel_id text not null,
        conversation_key_ciphertext blob not null,
        conversation_key_ref text not null,
        conversation_key_revision integer not null,
        conversation_key_hash text not null,
        conversation_kind text not null,
        agent_session_id text,
        created_at text not null,
        updated_at text not null,
        unique(channel_id, conversation_key_hash),
        unique(agent_session_id)
      );

      insert into channel_conversations_v2 (
        id, channel_id, conversation_key_ciphertext, conversation_key_ref, conversation_key_revision,
        conversation_key_hash, conversation_kind, agent_session_id, created_at, updated_at
      ) select
        id, channel_id, conversation_key_ciphertext, conversation_key_ref, conversation_key_revision,
        conversation_key_hash, conversation_kind, agent_session_id, created_at, updated_at
      from channel_conversations;

      drop table channel_conversations;
      alter table channel_conversations_v2 rename to channel_conversations;

      create index idx_channel_conversations_channel_updated
        on channel_conversations(channel_id, updated_at desc, id asc);
    `
  },
  {
    // Durable execution ledger: a started dispatch is never re-run after a crash.
    id: '0030_channel_dispatch_runs',
    up: `
      create table channel_dispatch_runs (
        dispatch_id text primary key,
        channel_id text not null,
        work_item_id text not null unique,
        conversation_id text not null,
        status text not null check (status in ('started','completed','failed','interrupted')),
        started_at text not null,
        finished_at text,
        updated_at text not null
      );
      create index idx_channel_dispatch_runs_recovery
        on channel_dispatch_runs(status, updated_at asc, dispatch_id asc);

      create table channel_dispatch_results (
        dispatch_id text primary key,
        channel_id text not null,
        conversation_id text not null,
        text_ciphertext blob not null,
        text_key_ref text not null,
        text_key_revision integer not null,
        status text not null check (status in ('pending','delivered','failed')),
        created_at text not null,
        updated_at text not null
      );
      create index idx_channel_dispatch_results_status
        on channel_dispatch_results(status, updated_at asc, dispatch_id asc);
    `
  },
  {
    // Unknown inbound conversations are recorded as key-only candidates; message bodies never land here.
    id: '0029_channel_inbound_candidates',
    up: `
      create table channel_inbound_candidates (
        id text primary key,
        channel_id text not null,
        conversation_kind text not null check (conversation_kind in ('direct','group','channel')),
        user_key_ciphertext blob not null,
        user_key_ref text not null,
        user_key_revision integer not null,
        user_key_hash text not null,
        conversation_key_ciphertext blob not null,
        conversation_key_ref text not null,
        conversation_key_revision integer not null,
        conversation_key_hash text not null,
        display_label text,
        first_seen_at text not null,
        last_seen_at text not null,
        hit_count integer not null default 1,
        status text not null default 'pending' check (status in ('pending','allowed','ignored')),
        unique(channel_id, conversation_kind, user_key_hash, conversation_key_hash)
      );
      create index idx_channel_inbound_candidates_pending
        on channel_inbound_candidates(channel_id, status, last_seen_at desc, id asc);
    `
  },
  {
    // Delivery retry metadata. Retry text is encrypted and only used for non-inbound sources.
    id: '0031_channel_delivery_retry',
    up: `
      alter table channel_delivery_attempts add column source_id text;
      alter table channel_delivery_attempts add column retry_payload_ciphertext blob;
      alter table channel_delivery_attempts add column retry_payload_key_ref text;
      alter table channel_delivery_attempts add column retry_payload_key_revision integer;
      alter table channel_delivery_attempts add column next_attempt_at text;
      create index idx_channel_delivery_attempts_due
        on channel_delivery_attempts(status, next_attempt_at asc, id asc);
    `
  },
  {
    // Canonical read projection over the legacy carrier columns. The destructive rebuild waits
    // until the legacy credential reconciler no longer needs config_json/migration_state.
    id: '0032_channel_adapter_key_projection',
    up: `
      alter table agent_channels add column adapter_key text
        generated always as (case when type = 'feishu' then 'lark' else type end) virtual;
      alter table agent_channels add column lifecycle_state text
        generated always as (
          case migration_state
            when 'runtime-ready' then 'enabled'
            when 'configuration-ready' then 'ready'
            else migration_state
          end
        ) virtual;
      create index idx_agent_channels_adapter_key on agent_channels(adapter_key);
      create index idx_agent_channels_lifecycle_state on agent_channels(lifecycle_state);
    `
  },
  {
    // Move legacy carrier rows out of the managed table so the reconciler no longer depends on it.
    id: '0033_channel_legacy_quarantine',
    up: `
      create table channel_legacy_channels (
        id text primary key,
        type text not null,
        name text not null,
        agent_id text,
        workspace_json text,
        public_config_json text,
        credential_ref text,
        credential_revision integer,
        requested_enabled integer not null default 0,
        migration_state text not null default 'legacy',
        migration_error_code text,
        legacy_session_state text,
        created_at text not null,
        updated_at text not null,
        config_json text,
        session_id text,
        is_active integer,
        active_chat_ids_json text,
        permission_mode text
      );

      insert or ignore into channel_legacy_channels (
        id, type, name, agent_id, workspace_json, public_config_json, credential_ref, credential_revision,
        requested_enabled, migration_state, migration_error_code, legacy_session_state, created_at, updated_at,
        config_json, session_id, is_active, active_chat_ids_json, permission_mode
      ) select
        id, type, name, agent_id, workspace_json, public_config_json, credential_ref, credential_revision,
        requested_enabled, migration_state, migration_error_code, legacy_session_state, created_at, updated_at,
        config_json, session_id, is_active, active_chat_ids_json, permission_mode
      from agent_channels
      where migration_state = 'legacy'
         or type not in ('telegram','slack','qq','discord','feishu','wechat')
         or (type = 'feishu' and public_config_json is not '{"domain":"lark"}')
         or (type = 'wechat' and public_config_json is not '{}');

      delete from agent_channels where id in (select id from channel_legacy_channels);
    `
  },
  {
    // Transitional canonical table: old table stays the write source, triggers mirror into this one.
    id: '0034_channel_canonical_shadow',
    up: `
      create table agent_channels_next (
        id text primary key,
        adapter_key text not null,
        name text not null,
        agent_id text,
        public_config_json text not null default '{}',
        credential_ref text,
        credential_revision integer,
        credential_health text not null default 'missing',
        requested_enabled integer not null default 0,
        lifecycle_state text not null default 'credential-missing',
        mutation_epoch integer not null default 0,
        migration_error_code text,
        created_at text not null,
        updated_at text not null
      );

      insert into agent_channels_next (
        id, adapter_key, name, agent_id, public_config_json, credential_ref, credential_revision,
        credential_health, requested_enabled, lifecycle_state, mutation_epoch, migration_error_code, created_at, updated_at
      ) select
        id, case when adapter_key = 'lark' then 'lark' else adapter_key end,
        name, agent_id, coalesce(public_config_json, '{}'), credential_ref, credential_revision,
        credential_health, requested_enabled,
        case lifecycle_state
          when 'runtime-ready' then 'enabled'
          when 'configuration-ready' then 'ready'
          when 'deleting' then 'deleting'
          when 'credential-missing' then 'credential-missing'
          else 'disabled'
        end,
        mutation_epoch, migration_error_code, created_at, updated_at
      from agent_channels;

      create trigger agent_channels_next_insert after insert on agent_channels begin
        insert into agent_channels_next (
          id, adapter_key, name, agent_id, public_config_json, credential_ref, credential_revision,
          credential_health, requested_enabled, lifecycle_state, mutation_epoch, migration_error_code, created_at, updated_at
        ) values (
          new.id, case when new.type = 'feishu' then 'lark' else new.type end, new.name, new.agent_id,
          coalesce(new.public_config_json, '{}'), new.credential_ref, new.credential_revision,
          new.credential_health, new.requested_enabled,
          case new.migration_state
            when 'runtime-ready' then 'enabled'
            when 'configuration-ready' then 'ready'
            when 'deleting' then 'deleting'
            when 'credential-missing' then 'credential-missing'
            else 'disabled'
          end,
          new.mutation_epoch, new.migration_error_code, new.created_at, new.updated_at
        ) on conflict(id) do update set
          adapter_key = excluded.adapter_key, name = excluded.name, agent_id = excluded.agent_id,
          public_config_json = excluded.public_config_json, credential_ref = excluded.credential_ref,
          credential_revision = excluded.credential_revision, credential_health = excluded.credential_health,
          requested_enabled = excluded.requested_enabled, lifecycle_state = excluded.lifecycle_state,
          mutation_epoch = excluded.mutation_epoch, migration_error_code = excluded.migration_error_code,
          created_at = excluded.created_at, updated_at = excluded.updated_at;
      end;

      create trigger agent_channels_next_update after update on agent_channels begin
        insert into agent_channels_next (
          id, adapter_key, name, agent_id, public_config_json, credential_ref, credential_revision,
          credential_health, requested_enabled, lifecycle_state, mutation_epoch, migration_error_code, created_at, updated_at
        ) values (
          new.id, case when new.type = 'feishu' then 'lark' else new.type end, new.name, new.agent_id,
          coalesce(new.public_config_json, '{}'), new.credential_ref, new.credential_revision,
          new.credential_health, new.requested_enabled,
          case new.migration_state
            when 'runtime-ready' then 'enabled'
            when 'configuration-ready' then 'ready'
            when 'deleting' then 'deleting'
            when 'credential-missing' then 'credential-missing'
            else 'disabled'
          end,
          new.mutation_epoch, new.migration_error_code, new.created_at, new.updated_at
        ) on conflict(id) do update set
          adapter_key = excluded.adapter_key, name = excluded.name, agent_id = excluded.agent_id,
          public_config_json = excluded.public_config_json, credential_ref = excluded.credential_ref,
          credential_revision = excluded.credential_revision, credential_health = excluded.credential_health,
          requested_enabled = excluded.requested_enabled, lifecycle_state = excluded.lifecycle_state,
          mutation_epoch = excluded.mutation_epoch, migration_error_code = excluded.migration_error_code,
          created_at = excluded.created_at, updated_at = excluded.updated_at;
      end;

      create trigger agent_channels_next_delete after delete on agent_channels begin
        delete from agent_channels_next where id = old.id;
      end;

      create index idx_agent_channels_next_agent_updated
        on agent_channels_next(agent_id, updated_at desc, id asc);
      create index idx_agent_channels_next_lifecycle
        on agent_channels_next(lifecycle_state, updated_at asc, id asc);
    `
  },
  {
    id: '0036_drop_legacy_channel_tables',
    up: `
      drop table if exists channel_legacy_discovery_archives;
      drop table if exists channel_credential_migrations;
      drop table if exists channel_legacy_channels;
    `
  },
  {
    id: '0038_channel_bridge_compat',
    up: (connection) => {
      const columns = connection.prepare('pragma table_info(agent_channels)').all() as Array<{ name: string }>
      // Fresh databases already have the legacy carrier table; only repair a canonical-only database.
      if (columns.some((column) => column.name === 'type')) return

      connection.exec(`
        drop table if exists agent_channels_next;
        create table agent_channels_bridge (
          id text primary key,
          type text not null,
          name text not null,
          agent_id text,
          workspace_json text,
          public_config_json text,
          credential_ref text,
          credential_revision integer,
          requested_enabled integer not null default 0,
          migration_state text not null default 'credential-missing',
          migration_error_code text,
          legacy_session_state text,
          created_at text not null,
          updated_at text not null,
          config_json text,
          session_id text,
          is_active integer,
          active_chat_ids_json text,
          permission_mode text,
          credential_health text not null default 'missing',
          mutation_epoch integer not null default 0,
          adapter_key text generated always as (case when type = 'feishu' then 'lark' else type end) virtual,
          lifecycle_state text generated always as (
            case migration_state
              when 'runtime-ready' then 'enabled'
              when 'configuration-ready' then 'ready'
              else migration_state
            end
          ) virtual
        );

        insert into agent_channels_bridge (
          id, type, name, agent_id, public_config_json, credential_ref, credential_revision,
          requested_enabled, migration_state, migration_error_code, created_at, updated_at,
          credential_health, mutation_epoch
        ) select
          id,
          case adapter_key when 'lark' then 'feishu' else adapter_key end,
          name, agent_id, public_config_json, credential_ref, credential_revision,
          requested_enabled,
          case lifecycle_state
            when 'enabled' then 'runtime-ready'
            when 'ready' then 'configuration-ready'
            else lifecycle_state
          end,
          migration_error_code, created_at, updated_at, credential_health, mutation_epoch
        from agent_channels;

        create table agent_channels_next (
          id text primary key,
          adapter_key text not null,
          name text not null,
          agent_id text,
          public_config_json text not null default '{}',
          credential_ref text,
          credential_revision integer,
          credential_health text not null default 'missing',
          requested_enabled integer not null default 0,
          lifecycle_state text not null default 'credential-missing',
          mutation_epoch integer not null default 0,
          migration_error_code text,
          created_at text not null,
          updated_at text not null
        );

        insert into agent_channels_next (
          id, adapter_key, name, agent_id, public_config_json, credential_ref, credential_revision,
          credential_health, requested_enabled, lifecycle_state, mutation_epoch, migration_error_code,
          created_at, updated_at
        ) select
          id, case adapter_key when 'lark' then 'lark' else adapter_key end,
          name, agent_id, public_config_json, credential_ref, credential_revision,
          credential_health, requested_enabled, lifecycle_state, mutation_epoch, migration_error_code,
          created_at, updated_at
        from agent_channels;

        drop table agent_channels;
        alter table agent_channels_bridge rename to agent_channels;

        create trigger agent_channels_next_insert after insert on agent_channels begin
          insert into agent_channels_next (
            id, adapter_key, name, agent_id, public_config_json, credential_ref, credential_revision,
            credential_health, requested_enabled, lifecycle_state, mutation_epoch, migration_error_code,
            created_at, updated_at
          ) values (
            new.id, case when new.type = 'feishu' then 'lark' else new.type end, new.name, new.agent_id,
            coalesce(new.public_config_json, '{}'), new.credential_ref, new.credential_revision,
            new.credential_health, new.requested_enabled,
            case new.migration_state
              when 'runtime-ready' then 'enabled'
              when 'configuration-ready' then 'ready'
              else new.migration_state
            end,
            new.mutation_epoch, new.migration_error_code, new.created_at, new.updated_at
          ) on conflict(id) do update set
            adapter_key = excluded.adapter_key, name = excluded.name, agent_id = excluded.agent_id,
            public_config_json = excluded.public_config_json, credential_ref = excluded.credential_ref,
            credential_revision = excluded.credential_revision, credential_health = excluded.credential_health,
            requested_enabled = excluded.requested_enabled, lifecycle_state = excluded.lifecycle_state,
            mutation_epoch = excluded.mutation_epoch, migration_error_code = excluded.migration_error_code,
            created_at = excluded.created_at, updated_at = excluded.updated_at;
        end;

        create trigger agent_channels_next_update after update on agent_channels begin
          insert into agent_channels_next (
            id, adapter_key, name, agent_id, public_config_json, credential_ref, credential_revision,
            credential_health, requested_enabled, lifecycle_state, mutation_epoch, migration_error_code,
            created_at, updated_at
          ) values (
            new.id, case when new.type = 'feishu' then 'lark' else new.type end, new.name, new.agent_id,
            coalesce(new.public_config_json, '{}'), new.credential_ref, new.credential_revision,
            new.credential_health, new.requested_enabled,
            case new.migration_state
              when 'runtime-ready' then 'enabled'
              when 'configuration-ready' then 'ready'
              else new.migration_state
            end,
            new.mutation_epoch, new.migration_error_code, new.created_at, new.updated_at
          ) on conflict(id) do update set
            adapter_key = excluded.adapter_key, name = excluded.name, agent_id = excluded.agent_id,
            public_config_json = excluded.public_config_json, credential_ref = excluded.credential_ref,
            credential_revision = excluded.credential_revision, credential_health = excluded.credential_health,
            requested_enabled = excluded.requested_enabled, lifecycle_state = excluded.lifecycle_state,
            mutation_epoch = excluded.mutation_epoch, migration_error_code = excluded.migration_error_code,
            created_at = excluded.created_at, updated_at = excluded.updated_at;
        end;

        create trigger agent_channels_next_delete after delete on agent_channels begin
          delete from agent_channels_next where id = old.id;
        end;
      `)
    }
  }
]

export type AgentPlatformDatabase = {
  connection: DatabaseSync
  transact: <T>(callback: () => T) => T
}

export function createAgentPlatformDatabase(path: string): AgentPlatformDatabase {
  const connection = new DatabaseSync(path)
  let transactionDepth = 0
  connection.exec('pragma foreign_keys = on;')
  applyMigrations(connection)
  return {
    connection,
    transact: <T>(callback: () => T) => runInTransaction(connection, callback, {
      getDepth: () => transactionDepth,
      setDepth: (nextDepth) => {
        transactionDepth = nextDepth
      }
    })
  }
}

function applyMigrations(connection: DatabaseSync): void {
  connection.exec(`
    create table if not exists agent_platform_migrations (
      id text primary key,
      applied_at text not null
    );
  `)

  for (const migration of migrations) {
    const applied = connection
      .prepare('select id from agent_platform_migrations where id = ?')
      .get(migration.id) as { id?: string } | undefined
    if (applied?.id) continue

    runInTransaction(connection, () => {
      if (typeof migration.up === 'string') connection.exec(migration.up)
      else migration.up(connection)
      connection
        .prepare('insert into agent_platform_migrations (id, applied_at) values (?, ?)')
        .run(migration.id, new Date().toISOString())
    })
  }
}

function runInTransaction<T>(
  connection: DatabaseSync,
  callback: () => T,
  depthState: {
    getDepth: () => number
    setDepth: (nextDepth: number) => void
  } = {
    getDepth: () => 0,
    setDepth: () => undefined
  }
): T {
  const depth = depthState.getDepth()
  const savepoint = `agent_platform_sp_${depth}`
  if (depth === 0) connection.exec('begin')
  else connection.exec(`savepoint ${savepoint}`)
  depthState.setDepth(depth + 1)
  try {
    const result = callback()
    depthState.setDepth(depth)
    if (depth === 0) connection.exec('commit')
    else connection.exec(`release savepoint ${savepoint}`)
    return result
  } catch (error) {
    depthState.setDepth(depth)
    if (depth === 0) {
      connection.exec('rollback')
    } else {
      connection.exec(`rollback to savepoint ${savepoint}`)
      connection.exec(`release savepoint ${savepoint}`)
    }
    throw error
  }
}
