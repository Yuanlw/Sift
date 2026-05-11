import type { PoolClient } from "pg";

interface SourceDeleteInput {
  captureIds: string[];
  sourceIds: string[];
  userId: string;
}

interface WikiDeleteInput {
  slugs: string[];
  userId: string;
  wikiPageIds: string[];
}

export async function deleteArchivedSources(
  client: PoolClient,
  input: SourceDeleteInput,
) {
  return deleteSourcesCascade(client, input);
}

export async function deleteSourcesCascade(
  client: PoolClient,
  input: SourceDeleteInput,
) {
  if (input.captureIds.length === 0 || input.sourceIds.length === 0) {
    return;
  }

  const wikiPageIds = await loadWikiPagesOwnedBySources(client, input.userId, input.sourceIds);
  await deleteKnowledgeEntities(client, {
    captureIds: input.captureIds,
    sourceIds: input.sourceIds,
    userId: input.userId,
    wikiPageIds,
  });
}

export async function deleteArchivedWikiPages(
  client: PoolClient,
  input: WikiDeleteInput,
) {
  return deleteWikiPagesCascade(client, input);
}

export async function deleteWikiPagesCascade(
  client: PoolClient,
  input: WikiDeleteInput,
) {
  if (input.slugs.length === 0 || input.wikiPageIds.length === 0) {
    return;
  }

  const sourceRows = await loadSourcesOwnedByWikiPages(client, input.userId, input.wikiPageIds);
  await deleteKnowledgeEntities(client, {
    captureIds: sourceRows.map((row) => row.capture_id),
    sourceIds: sourceRows.map((row) => row.source_id),
    userId: input.userId,
    wikiPageIds: input.wikiPageIds,
  });
}

async function deleteKnowledgeEntities(
  client: PoolClient,
  input: {
    captureIds: string[];
    sourceIds: string[];
    userId: string;
    wikiPageIds: string[];
  },
) {
  const sourceIds = uniqueValues(input.sourceIds);
  const captureIds = uniqueValues(input.captureIds);
  const wikiPageIds = uniqueValues(input.wikiPageIds);

  if (sourceIds.length > 0 || wikiPageIds.length > 0) {
    await client.query(
      `
        delete from knowledge_edges
        where user_id = $1
          and (
            (from_type = 'source' and from_id = any($2::uuid[]))
            or (to_type = 'source' and to_id = any($2::uuid[]))
            or (from_type = 'wiki_page' and from_id = any($3::uuid[]))
            or (to_type = 'wiki_page' and to_id = any($3::uuid[]))
          )
      `,
      [input.userId, sourceIds, wikiPageIds],
    );
  }

  if (sourceIds.length > 0) {
    await client.query(
      `
        delete from chunks
        where user_id = $1
          and parent_type = 'source'
          and parent_id = any($2::uuid[])
      `,
      [input.userId, sourceIds],
    );

    await client.query(
      `
        delete from ask_histories
        where user_id = $1
          and scope_type = 'source'
          and scope_id = any($2::uuid[])
      `,
      [input.userId, sourceIds],
    );
  }

  if (wikiPageIds.length > 0) {
    await client.query(
      `
        delete from chunks
        where user_id = $1
          and parent_type = 'wiki_page'
          and parent_id = any($2::uuid[])
      `,
      [input.userId, wikiPageIds],
    );

    await client.query(
      `
        delete from ask_histories
        where user_id = $1
          and scope_type = 'wiki_page'
          and scope_id = any($2::uuid[])
      `,
      [input.userId, wikiPageIds],
    );

    await client.query(
      `
        delete from wiki_pages
        where user_id = $1
          and id = any($2::uuid[])
      `,
      [input.userId, wikiPageIds],
    );
  }

  if (captureIds.length > 0) {
    await client.query(
      `
        delete from captures
        where user_id = $1
          and id = any($2::uuid[])
      `,
      [input.userId, captureIds],
    );
  }
}

async function loadWikiPagesOwnedBySources(
  client: PoolClient,
  userId: string,
  sourceIds: string[],
) {
  const result = await client.query<{ wiki_page_id: string }>(
    `
      select distinct swp.wiki_page_id
      from source_wiki_pages swp
      join wiki_pages wp on wp.id = swp.wiki_page_id
      where wp.user_id = $1
        and swp.source_id = any($2::uuid[])
        and not exists (
          select 1
          from source_wiki_pages other_swp
          join sources other_s on other_s.id = other_swp.source_id
          where other_swp.wiki_page_id = swp.wiki_page_id
            and other_s.user_id = $1
            and other_swp.source_id <> all($2::uuid[])
        )
    `,
    [userId, sourceIds],
  );

  return result.rows.map((row) => row.wiki_page_id);
}

async function loadSourcesOwnedByWikiPages(
  client: PoolClient,
  userId: string,
  wikiPageIds: string[],
) {
  const result = await client.query<{ capture_id: string; source_id: string }>(
    `
      select distinct s.id as source_id, s.capture_id
      from sources s
      join source_wiki_pages swp on swp.source_id = s.id
      where s.user_id = $1
        and swp.wiki_page_id = any($2::uuid[])
        and not exists (
          select 1
          from source_wiki_pages other_swp
          join wiki_pages other_wp on other_wp.id = other_swp.wiki_page_id
          where other_swp.source_id = s.id
            and other_wp.user_id = $1
            and other_swp.wiki_page_id <> all($2::uuid[])
        )
    `,
    [userId, wikiPageIds],
  );

  return result.rows;
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values));
}
