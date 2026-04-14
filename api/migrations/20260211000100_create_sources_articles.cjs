exports.up = async function up(knex) {
  await knex.schema.createTable("sources", (table) => {
    table.increments("id").primary();
    table.string("name").notNullable();
    table.string("url");
    table.string("lccn").unique();
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("articles", (table) => {
    table.increments("id").primary();
    table
      .integer("source_id")
      .unsigned()
      .references("id")
      .inTable("sources")
      .onDelete("CASCADE");
    table.string("title").notNullable();
    table.date("date").notNullable();
    table.string("url").notNullable();
    table.text("snippet");
    table.string("ocr_url");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
    table.unique(["source_id", "url"]);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("articles");
  await knex.schema.dropTableIfExists("sources");
};
