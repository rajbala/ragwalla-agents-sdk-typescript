import { Ragwalla } from '../src';

// Example: Vector store search
async function vectorSearchExample() {
  const ragwalla = new Ragwalla({
    apiKey: process.env.RAGWALLA_API_KEY!,
    baseURL: 'https://example.ai.ragwalla.com/v1' // Replace with your organization's URL
  });

  try {
    // Replace with your actual vector store ID
    const vectorStoreId = 'vs_example123';

    // Simple text search
    console.log('Performing simple vector search...');
    const searchResults = await ragwalla.vectorStores.search(vectorStoreId, {
      query: 'How to authenticate with the API?',
      max_num_results: 5
    });

    console.log('Search results:');
    searchResults.data.forEach((result, index) => {
      console.log(`${index + 1}. Score: ${result.score}`);
      console.log(`   File: ${result.filename} (${result.file_id})`);
      console.log(`   Content: ${result.content.map(item => item.text).join('\n')}`);
      console.log(`   Attributes:`, result.attributes);
      console.log('---');
    });

    // Search with filters and ranking options
    console.log('\nPerforming filtered vector search...');
    const filteredResults = await ragwalla.vectorStores.search(vectorStoreId, {
      query: 'JavaScript SDK examples',
      max_num_results: 3,
      filters: {
        language: 'javascript',
        category: 'documentation'
      },
      rewrite_query: true,
      ranking_options: {
        ranker: 'hybrid',
        score_threshold: 0.7
      }
    });

    console.log('Filtered search results:');
    filteredResults.data.forEach((result, index) => {
      console.log(`${index + 1}. Score: ${result.score}`);
      console.log(`   Content: ${result.content.map(item => item.text).join('\n')}`);
      console.log('---');
    });

    if (searchResults.has_more && searchResults.next_page) {
      const nextPage = await ragwalla.vectorStores.search(
        vectorStoreId,
        { query: 'How to authenticate with the API?', max_num_results: 5 },
        { page_token: searchResults.next_page }
      );
      console.log(`Next page contains ${nextPage.data.length} results`);
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the example
if (require.main === module) {
  vectorSearchExample();
}
