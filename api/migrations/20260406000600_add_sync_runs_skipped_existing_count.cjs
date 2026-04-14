exports.up = async function up(knex) {
  const hasSkippedExistingCount = await knex.schema.hasColumn("sync_runs", "skipped_existing_count");
  if (!hasSkippedExistingCount) {
    await knex.schema.alterTable("sync_runs", (table) => {
      table.integer("skipped_existing_count").notNullable().defaultTo(0);
    });
  }
};

exports.down = async function down(knex) {
  const hasSkippedExistingCount = await knex.schema.hasColumn("sync_runs", "skipped_existing_count");
  if (hasSkippedExistingCount) {
    await knex.schema.alterTable("sync_runs", (table) => {
      table.dropColumn("skipped_existing_count");
    });
  }
};
