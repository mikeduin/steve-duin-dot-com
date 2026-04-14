exports.up = async function up(knex) {
  const hasExternalKey = await knex.schema.hasColumn("articles", "external_key");
  if (!hasExternalKey) {
    await knex.schema.alterTable("articles", (table) => {
      table.string("external_key");
    });
  }

  await knex.raw(`
    update articles
    set external_key = url
    where external_key is null and url is not null
  `);

  await knex.raw(`
    update articles
    set external_key = concat(
      'newsbank:',
      replace(
        replace(
          substring(replace(url, '&amp;', '&') from 'docref=([^&]+)'),
          '%2F',
          '/'
        ),
        '%2f',
        '/'
      )
    )
    where url like '%docref=%'
  `);

  await knex.raw(`
    delete from articles a
    using articles b
    where a.id < b.id
      and a.source_id = b.source_id
      and a.external_key is not null
      and b.external_key is not null
      and a.external_key = b.external_key
  `);

  await knex.raw(`
    create unique index if not exists articles_source_external_key_unique
    on articles (source_id, external_key)
    where external_key is not null
  `);

  const hasSyncRuns = await knex.schema.hasTable("sync_runs");
  if (!hasSyncRuns) {
    await knex.schema.createTable("sync_runs", (table) => {
      table.increments("id").primary();
      table.string("source_name").notNullable();
      table.string("status").notNullable().defaultTo("queued");
      table.boolean("prune_stale").notNullable().defaultTo(true);
      table.integer("max_pages");
      table.integer("max_articles");
      table.integer("total_discovered").notNullable().defaultTo(0);
      table.integer("processed_count").notNullable().defaultTo(0);
      table.integer("inserted_count").notNullable().defaultTo(0);
      table.integer("updated_count").notNullable().defaultTo(0);
      table.integer("failed_count").notNullable().defaultTo(0);
      table.integer("deleted_stale_count").notNullable().defaultTo(0);
      table.text("error_message");
      table.timestamp("started_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("finished_at");
      table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at").notNullable().defaultTo(knex.fn.now());
    });

    await knex.schema.alterTable("sync_runs", (table) => {
      table.index(["source_name", "status"], "sync_runs_source_status_idx");
      table.index(["source_name", "created_at"], "sync_runs_source_created_idx");
    });
  }
};

exports.down = async function down(knex) {
  const hasSyncRuns = await knex.schema.hasTable("sync_runs");
  if (hasSyncRuns) {
    await knex.schema.dropTable("sync_runs");
  }

  await knex.raw("drop index if exists articles_source_external_key_unique");

  const hasExternalKey = await knex.schema.hasColumn("articles", "external_key");
  if (hasExternalKey) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("external_key");
    });
  }
};
