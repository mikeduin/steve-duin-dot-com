import { gql, useLazyQuery } from "@apollo/client";
import { useState } from "react";

const SEARCH_ARTICLES = gql`
  query SearchArticles($query: String!) {
    searchArticles(query: $query) {
      id
      title
      date
      snippet
      url
      source {
        id
        name
      }
    }
  }
`;

function App() {
  const [query, setQuery] = useState("");
  const [search, { data, loading, error }] = useLazyQuery(SEARCH_ARTICLES);

  return (
    <div className="page">
      <header className="hero">
        <h1>Steve Duin Archive</h1>
        <p>Search and explore columns and mentions.</p>
      </header>

      <section className="search">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search articles..."
        />
        <button onClick={() => search({ variables: { query } })} disabled={!query.trim()}>
          Search
        </button>
      </section>

      <section className="results">
        {loading && <p>Loading...</p>}
        {error && <p className="error">{error.message}</p>}
        {!loading && data?.searchArticles?.length === 0 && query && (
          <p>No results yet.</p>
        )}
        {data?.searchArticles?.map((article) => (
          <article key={article.id} className="card">
            <h2>{article.title}</h2>
            <div className="meta">
              <span>{article.date}</span>
              <span>·</span>
              <span>{article.source.name}</span>
            </div>
            {article.snippet && <p>{article.snippet}</p>}
            {article.url && (
              <a href={article.url} target="_blank" rel="noreferrer">
                Read article
              </a>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

export default App;
