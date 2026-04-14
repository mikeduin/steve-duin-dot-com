exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn("articles", "is_newsbank_duplicate");
  if (!hasColumn) {
    await knex.schema.alterTable("articles", (table) => {
      table.boolean("is_newsbank_duplicate").notNullable().defaultTo(false);
    });
  }

  await knex.raw(
    "create index if not exists articles_is_newsbank_duplicate_idx on articles (is_newsbank_duplicate)"
  );
};

exports.down = async function down(knex) {
  await knex.raw("drop index if exists articles_is_newsbank_duplicate_idx");

  const hasColumn = await knex.schema.hasColumn("articles", "is_newsbank_duplicate");
  if (hasColumn) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("is_newsbank_duplicate");
    });
  }
};
