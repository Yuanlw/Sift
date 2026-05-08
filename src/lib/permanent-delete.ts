import type { PoolClient } from "pg";

export async function deleteArchivedSources(
  client: PoolClient,
  input: {
    captureIds: string[];
    sourceIds: string[];
    userId: string;
  },
) {
  if (input.captureIds.length === 0 || input.sourceIds.length === 0) {
    return;
  }

  await client.query(
    `
      delete from knowledge_edges
      where user_id = $1
        and (
          (from_type = 'source' and from_id = any($2::uuid[]))
          or (to_type = 'source' and to_id = any($2::uuid[]))
        )
    `,
    [input.userId, input.sourceIds],
  );

  await client.query(
    `
      delete from chunks
      where user_id = $1
        and parent_type = 'source'
        and parent_id = any($2::uuid[])
    `,
    [input.userId, input.sourceIds],
  );

  await client.query(
    `
      delete from ask_histories
      where user_id = $1
        and scope_type = 'source'
        and scope_id = any($2::uuid[])
    `,
    [input.userId, input.sourceIds],
  );

  await client.query(
    `
      delete from captures
      where user_id = $1
        and id = any($2::uuid[])
        and status = 'ignored'
    `,
    [input.userId, input.captureIds],
  );
}

export async function deleteArchivedWikiPages(
  client: PoolClient,
  input: {
    slugs: string[];
    userId: string;
    wikiPageIds: string[];
  },
) {
  if (input.slugs.length === 0 || input.wikiPageIds.length === 0) {
    return;
  }

  await client.query(
    `
      delete from knowledge_edges
      where user_id = $1
        and (
          (from_type = 'wiki_page' and from_id = any($2::uuid[]))
          or (to_type = 'wiki_page' and to_id = any($2::uuid[]))
        )
    `,
    [input.userId, input.wikiPageIds],
  );

  await client.query(
    `
      delete from chunks
      where user_id = $1
        and parent_type = 'wiki_page'
        and parent_id = any($2::uuid[])
    `,
    [input.userId, input.wikiPageIds],
  );

  await client.query(
    `
      delete from ask_histories
      where user_id = $1
        and scope_type = 'wiki_page'
        and scope_id = any($2::uuid[])
    `,
    [input.userId, input.wikiPageIds],
  );

  await client.query(
    `
      delete from wiki_pages
      where user_id = $1
        and slug = any($2::text[])
        and status = 'archived'
    `,
    [input.userId, input.slugs],
  );
}
