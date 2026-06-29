### Thoughts 6/28/26
File explorer has duplicate txt and html of the same content. Find user values and decide what to show - html can be configured further to design app specific preview or text file can be used as one-click context retrieval. 

Seems like for Local Excerpt section in buildContextResult() uses arbitrary head parts of those duplicates. The idea is to segment those duplicate source files to only add content of the query relevant graph nodes - for this task I think html is better. But html also adds additional syntax tokens which cost more.

I think it's better to send *parts* of the prompt for the graph query - the challenge is which words, how to understand user intent without sending it to LLM, should user explicitly tag those words? Doesn't it defeat the whole purpose? Local excerpt can't hold the whole source - it's not economical. 