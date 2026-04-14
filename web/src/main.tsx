import React from "react";
import ReactDOM from "react-dom/client";
import { ApolloClient, ApolloProvider, InMemoryCache } from "@apollo/client";
import App from "./App";
import "./styles.css";

const graphqlUrl =
  import.meta.env.VITE_GRAPHQL_URL ??
  (import.meta.env.DEV ? "http://localhost:4000/graphql" : "/graphql");

const client = new ApolloClient({
  uri: graphqlUrl,
  cache: new InMemoryCache()
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ApolloProvider client={client}>
      <App />
    </ApolloProvider>
  </React.StrictMode>
);
