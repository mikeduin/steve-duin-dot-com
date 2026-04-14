exports.up = async function up(knex) {
  await knex.schema.createTable("newsbank_request_configs", (table) => {
    table.increments("id").primary();
    table.string("key").notNullable().unique();
    table.text("curl_text").notNullable();
    table.string("request_url");
    table.string("method").notNullable().defaultTo("GET");
    table.text("cookie_header");
    table.jsonb("headers_json").notNullable().defaultTo("{}");
    table.text("body_text");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.timestamp("updated_at").defaultTo(knex.fn.now());
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("newsbank_request_configs");
};
