### Thoughts 6/28/26
File explorer has duplicate txt and html of the same content. Find user values and decide what to show - html can be configured further to design app specific preview or text file can be used as one-click context retrieval. 

Seems like for Local Excerpt section in buildContextResult() uses arbitrary head parts of those duplicates. The idea is to segment those duplicate source files to only add content of the query relevant graph nodes - for this task I think html is better. But html also adds additional syntax tokens which cost more.

I think it's better to send *parts* of the prompt for the graph query - the challenge is which words, how to understand user intent without sending it to LLM, should user explicitly tag those words? Doesn't it defeat the whole purpose? Local excerpt can't hold the whole source - it's not economical. 

## Thoughts 7/6/26
The memory creation using graphify-save-result mcp tool connects nodeHits by each query in the Board view. Now the future query doesn't learn the user-informed/interation connections unless /graphify reflect is called.

Graphify versions should be tracked with the prod build's dependency installation scripts. Whatever I'm testing on should be shipped.

Audio/video fall in the type 'graphify[[video]]', transcription requires whispr-base.en which has 1 gb VRAM requirements.

