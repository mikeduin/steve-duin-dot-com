exports.up = async function up(knex) {
  await knex.schema.alterTable("articles", (table) => {
    table.text("title").notNullable().alter();
    table.text("url").notNullable().alter();
    table.text("ocr_url").alter();
    table.text("extraction_method").alter();
    table.text("external_key").alter();
    table.text("publication_name").alter();
    table.text("byline").alter();
    table.text("article_section").alter();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("articles", (table) => {
    table.string("title", 255).notNullable().alter();
    table.string("url", 255).notNullable().alter();
    table.string("ocr_url", 255).alter();
    table.string("extraction_method", 255).alter();
    table.string("external_key", 255).alter();
    table.string("publication_name", 255).alter();
    table.string("byline", 255).alter();
    table.string("article_section", 255).alter();
  });
};
