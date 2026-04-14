exports.up = async function up(knex) {
  const hasBodyText = await knex.schema.hasColumn("articles", "body_text");
  if (!hasBodyText) {
    await knex.schema.alterTable("articles", (table) => {
      table.text("body_text");
    });
  }

  const hasBodyHtml = await knex.schema.hasColumn("articles", "body_html");
  if (!hasBodyHtml) {
    await knex.schema.alterTable("articles", (table) => {
      table.text("body_html");
    });
  }

  const hasExtractedAt = await knex.schema.hasColumn("articles", "content_extracted_at");
  if (!hasExtractedAt) {
    await knex.schema.alterTable("articles", (table) => {
      table.timestamp("content_extracted_at");
    });
  }

  const hasMethod = await knex.schema.hasColumn("articles", "extraction_method");
  if (!hasMethod) {
    await knex.schema.alterTable("articles", (table) => {
      table.string("extraction_method");
    });
  }
};

exports.down = async function down(knex) {
  const hasMethod = await knex.schema.hasColumn("articles", "extraction_method");
  if (hasMethod) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("extraction_method");
    });
  }

  const hasExtractedAt = await knex.schema.hasColumn("articles", "content_extracted_at");
  if (hasExtractedAt) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("content_extracted_at");
    });
  }

  const hasBodyHtml = await knex.schema.hasColumn("articles", "body_html");
  if (hasBodyHtml) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("body_html");
    });
  }

  const hasBodyText = await knex.schema.hasColumn("articles", "body_text");
  if (hasBodyText) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("body_text");
    });
  }
};
