exports.up = async function up(knex) {
  const hasTags = await knex.schema.hasColumn("articles", "tags");
  if (!hasTags) {
    await knex.schema.alterTable("articles", (table) => {
      table.specificType("tags", "text[]").notNullable().defaultTo("{}");
    });
  }

  await knex.raw(
    "create index if not exists articles_tags_gin_idx on articles using gin (tags)"
  );
};

exports.down = async function down(knex) {
  await knex.raw("drop index if exists articles_tags_gin_idx");

  const hasTags = await knex.schema.hasColumn("articles", "tags");
  if (hasTags) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("tags");
    });
  }
};
