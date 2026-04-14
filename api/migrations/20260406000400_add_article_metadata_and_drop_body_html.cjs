exports.up = async function up(knex) {
  const hasPublication = await knex.schema.hasColumn("articles", "publication_name");
  if (!hasPublication) {
    await knex.schema.alterTable("articles", (table) => {
      table.string("publication_name");
    });
  }

  const hasByline = await knex.schema.hasColumn("articles", "byline");
  if (!hasByline) {
    await knex.schema.alterTable("articles", (table) => {
      table.string("byline");
    });
  }

  const hasArticleSection = await knex.schema.hasColumn("articles", "article_section");
  if (!hasArticleSection) {
    await knex.schema.alterTable("articles", (table) => {
      table.string("article_section");
    });
  }

  const hasWordCount = await knex.schema.hasColumn("articles", "word_count");
  if (!hasWordCount) {
    await knex.schema.alterTable("articles", (table) => {
      table.integer("word_count");
    });
  }

  const hasSourceMetadata = await knex.schema.hasColumn("articles", "source_metadata");
  if (!hasSourceMetadata) {
    await knex.schema.alterTable("articles", (table) => {
      table.text("source_metadata");
    });
  }

  const hasBodyHtml = await knex.schema.hasColumn("articles", "body_html");
  if (hasBodyHtml) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("body_html");
    });
  }
};

exports.down = async function down(knex) {
  const hasBodyHtml = await knex.schema.hasColumn("articles", "body_html");
  if (!hasBodyHtml) {
    await knex.schema.alterTable("articles", (table) => {
      table.text("body_html");
    });
  }

  const hasSourceMetadata = await knex.schema.hasColumn("articles", "source_metadata");
  if (hasSourceMetadata) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("source_metadata");
    });
  }

  const hasWordCount = await knex.schema.hasColumn("articles", "word_count");
  if (hasWordCount) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("word_count");
    });
  }

  const hasArticleSection = await knex.schema.hasColumn("articles", "article_section");
  if (hasArticleSection) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("article_section");
    });
  }

  const hasByline = await knex.schema.hasColumn("articles", "byline");
  if (hasByline) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("byline");
    });
  }

  const hasPublication = await knex.schema.hasColumn("articles", "publication_name");
  if (hasPublication) {
    await knex.schema.alterTable("articles", (table) => {
      table.dropColumn("publication_name");
    });
  }
};
