import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./components/ui/card";
import { Button } from "./components/ui/button";
import { format, subDays, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import sourceInfo from './sourceInfo.json';

const API_KEY = process.env.REACT_APP_PERIGON_API_KEY;
const FAITH_SOURCES = [
  'christianpost.com', 'christianitytoday.com', 'relevantmagazine.com', 'wng.org', 
  'cbn.com', 'churchleaders.com', 'washingtoninformer.com', 'religionunplugged.com', 
  'premierchristian.news', 'news.ag.org', 'baptistpress.com'
];
const CATEGORIES = ['Politics', 'Tech', 'Finance', 'Business', 'Health', 'General'];

const BiasRatingSlider = ({ rating }) => {
  const ratingValues = {
    'Left': 0,
    'Lean Left': 25,
    'Center': 50,
    'Lean Right': 75,
    'Right': 100
  };

  const sliderValue = ratingValues[rating];

  return (
    <div className="flex flex-col items-center w-full mt-2">
      <div className="w-full flex justify-between text-xs mb-1">
        <span>Left</span>
        <span>Center</span>
        <span>Right</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2 relative">
        {sliderValue !== undefined && (
          <div 
            className="absolute top-1/2 transform -translate-y-1/2 w-4 h-4 bg-blue-600 rounded-full"
            style={{ left: `calc(${sliderValue}% - 8px)` }}
          ></div>
        )}
      </div>
      <div className="w-full flex justify-between text-xs mt-1">
        <span>|</span>
        <span>|</span>
        <span>|</span>
        <span>|</span>
        <span>|</span>
      </div>
      <span className="text-sm mt-1">{rating || "No rating available"}</span>
    </div>
  );
};

const generateQuestion = async (title, content) => {
  const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;
  const API_URL = 'https://api.openai.com/v1/chat/completions';

  const prompt = `There is a news article with the following content "${title}" "${content}". generate a brief question to ask a search engine about this article`;

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{role: "user", content: prompt}],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error generating question:", error);
    return "Failed to generate question";
  }
};

const callPerigonAPI = async (question) => {
  const API_URL = 'https://api.goperigon.com/v1/answers/chatbot/threads/chat';

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        content: question,
        stream: true,
        threadId: 1
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body.getReader();
    let result = '';
    let citations = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = new TextDecoder().decode(value);
      const lines = chunk.split('\n').filter(line => line.trim() !== '');
      
      for (const line of lines) {
        const parsedLine = JSON.parse(line);
        if (parsedLine.type === 'RESPONSE_CHUNK') {
          result += parsedLine.content;
        } else if (parsedLine.type === 'CITATION') {
          citations.push(parsedLine);
        }
      }
    }

    return { content: result.trim(), citations };
  } catch (error) {
    console.error("Error calling Perigon API:", error);
    return { content: "Failed to get response from Perigon API", citations: [] };
  }
};

const formatPerigonResponse = (response, citations) => {
  if (!response) return '';

  // Step 1: Bold text formatting
  let formattedResponse = response.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Step 2: Citation hyperlinks
  const citationMap = {};
  citations.forEach(citation => {
    citationMap[citation.sequenceIndex] = citation.url;
  });

  formattedResponse = formattedResponse.replace(/\[(\d+)\]/g, (match, p1) => {
    const citationNumber = parseInt(p1);
    const url = citationMap[citationNumber];
    if (url) {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">[${citationNumber}]</a>`;
    }
    return match; // If no matching citation found, leave the original text unchanged
  });

  // Step 3: Remove "Perigon Response:" prefix if present
  formattedResponse = formattedResponse.replace(/^Perigon Response:\s*/i, '');

  return formattedResponse;
};

const NewsApp = () => {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSources, setSelectedSources] = useState(FAITH_SOURCES);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [dateOffset, setDateOffset] = useState(0);
  const [sourceType, setSourceType] = useState('faith');
  const [perigonResponses, setPerigonResponses] = useState({});
  const [loadingResponses, setLoadingResponses] = useState({});

  useEffect(() => {
    if (sourceType === 'faith') {
      fetchFaithNews();
    } else {
      fetchMainstreamNews();
    }
  }, [selectedSources, selectedCategories, dateOffset, sourceType]);

  const fetchFaithNews = async () => {
    setLoading(true);
    const today = new Date();
    const to = format(subDays(today, dateOffset), 'yyyy-MM-dd');
    const from = format(subDays(today, dateOffset + 1), 'yyyy-MM-dd');
    
    const sourceParams = selectedSources.map(source => `source=${source}`).join('&');
    const categoryParams = selectedCategories.map(category => `category=${category}`).join('&');
    
    const API_URL = `https://api.goperigon.com/v1/all?apiKey=${API_KEY}&from=${from}&to=${to}&showNumResults=true&size=18&sortBy=date&${sourceParams}&${categoryParams}`;
    
    try {
      const response = await fetch(API_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      console.log("Faith-aligned API response:", data);
      setNews(data.articles);
      setLoading(false);
    } catch (e) {
      console.error("Error fetching faith-aligned news:", e);
      setError('Failed to fetch news');
      setLoading(false);
    }
  };

  const fetchMainstreamNews = async () => {
    setLoading(true);
    const today = new Date();
    const to = format(subDays(today, dateOffset), 'yyyy-MM-dd');
    const from = format(subDays(today, dateOffset + 1), 'yyyy-MM-dd');
    
    const API_URL = `https://api.goperigon.com/v1/headlines?apiKey=${API_KEY}&from=${from}&to=${to}&sourceGroup=top10&showNumResults=true&size=18&sortBy=date`;
    
    try {
      const response = await fetch(API_URL);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      console.log("Mainstream API response:", data);

      if (data.clusters && Array.isArray(data.clusters)) {
        const articles = data.clusters.map(cluster => cluster.hits[0]).filter(Boolean);
        setNews(articles.slice(0, 18)); // Ensure we only take up to 18 articles
      } else {
        console.error("Unexpected API response structure:", data);
        setNews([]);
      }
      setLoading(false);
    } catch (e) {
      console.error("Error fetching mainstream news:", e);
      setError('Failed to fetch news');
      setLoading(false);
    }
  };

  const handleSourceToggle = (source) => {
    setSelectedSources(prev => 
      prev.includes(source) ? prev.filter(s => s !== source) : [...prev, source]
    );
  };

  const handleCategoryChange = (category) => {
    setSelectedCategories(prev => 
      prev.includes(category) ? prev.filter(c => c !== category) : [...prev, category]
    );
  };

  const formatDate = (dateString) => {
    const date = parseISO(dateString);
    return format(date, 'MMMM d, yyyy h:mm a');
  };

  const handleDateChange = (direction) => {
    if (direction === 'left') {
      setDateOffset(prev => prev + 1);
    } else if (direction === 'right' && dateOffset > 0) {
      setDateOffset(prev => prev - 1);
    }
  };

  const renderFavicon = (domain) => {
    const source = sourceInfo.results.find(s => s.domain === domain);
    if (source?.logoFavIcon?.url) {
      return (
        <img 
          src={source.logoFavIcon.url} 
          alt={`${domain} favicon`}
          className="w-4 h-4 flex-shrink-0"
          onError={(e) => {
            e.target.onerror = null; 
            e.target.style.display = 'none';
          }}
        />
      );
    }
    return null;
  };

  const getBiasRating = (source) => {
    return source?.mbfcBiasRating || source?.allSidesBiasRating || source?.adFontesBiasRating || null;
  };

  const handleCheckMainstream = async (articleId, title, content) => {
    if (!perigonResponses[articleId]) {
      setLoadingResponses(prev => ({ ...prev, [articleId]: true }));
      let question = await generateQuestion(title, content);
      question += " in less than 200 words";
      const perigonResponse = await callPerigonAPI(question);
      setPerigonResponses(prev => ({ ...prev, [articleId]: perigonResponse }));
      setLoadingResponses(prev => ({ ...prev, [articleId]: false }));
    }
  };

  if (loading) return <div className="flex justify-center items-center h-screen">Loading...</div>;
  if (error) return <div className="flex justify-center items-center h-screen text-red-500">{error}</div>;

  const today = new Date();
  const dateRangeEnd = format(subDays(today, dateOffset), 'MMM d, yyyy');
  const dateRangeStart = format(subDays(today, dateOffset + 1), 'MMM d, yyyy');

  

  return (
    <div className="container mx-auto p-4 bg-gray-100 min-h-screen">
      <h1 className="text-4xl font-bold mb-8 text-center text-blue-600">Latest News</h1>
      
      <div className="mb-8 flex flex-col items-center gap-4">
        <div className="flex justify-center w-full mb-4">
          <Button
            onClick={() => setSourceType('mainstream')}
            className={`mr-2 ${sourceType === 'mainstream' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Mainstream
          </Button>
          <Button
            onClick={() => setSourceType('faith')}
            className={`${sourceType === 'faith' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
          >
            Faith Aligned
          </Button>
        </div>

        <div className="flex items-center justify-center w-full bg-white p-4 rounded-lg shadow">
          <Button 
            onClick={() => handleDateChange('left')}
            className="bg-blue-500 hover:bg-blue-600 text-white"
          >
            <ChevronLeft />
          </Button>
          <span className="mx-4 font-semibold">
            {dateRangeStart} - {dateRangeEnd}
          </span>
          <Button 
            onClick={() => handleDateChange('right')}
            disabled={dateOffset === 0}
            className={`bg-blue-500 hover:bg-blue-600 text-white ${dateOffset === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <ChevronRight />
          </Button>
        </div>

        {sourceType === 'faith' && (
          <>
            <div className="flex flex-wrap justify-center gap-2 w-full bg-white p-4 rounded-lg shadow">
              {FAITH_SOURCES.map(source => (
                <Button
                  key={source}
                  onClick={() => handleSourceToggle(source)}
                  className={`${
                    selectedSources.includes(source) 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-200 text-gray-700'
                  } hover:bg-blue-600 hover:text-white`}
                  >
                  {source.split('.')[0]}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap justify-center gap-2 w-full bg-white p-4 rounded-lg shadow">
              {CATEGORIES.map(category => (
                <Button
                  key={category}
                  onClick={() => handleCategoryChange(category)}
                  className={`${
                    selectedCategories.includes(category) 
                      ? 'bg-green-500 text-white' 
                      : 'bg-gray-200 text-gray-700'
                  } hover:bg-green-600 hover:text-white`}
                >
                  {category}
                </Button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {news && news.length > 0 ? (
          news.map((article, index) => {
            const source = sourceInfo.results.find(s => s.domain === article.source.domain);
            const biasRating = getBiasRating(source);
            
            return (
              <Card key={index} className="flex flex-col overflow-hidden shadow-lg hover:shadow-xl transition-shadow duration-300">
  {article.imageUrl && (
    <img 
      src={article.imageUrl} 
      alt={article.title} 
      className="w-full h-48 object-cover"
      onError={(e) => {
        e.target.onerror = null; // prevents looping
        e.target.src = "https://dapologeticsimages.s3.amazonaws.com/other/gloonews.jpg";
      }}
    />
  )}
  {!article.imageUrl && (
    <img 
      src="https://dapologeticsimages.s3.amazonaws.com/other/gloonews.jpg" 
      alt="Fallback image" 
      className="w-full h-48 object-cover"
    />
  )}
 <CardHeader>
  <CardTitle className="text-xl font-semibold text-gray-800">{article.title}</CardTitle>
  <CardDescription className="text-sm text-gray-500 flex items-center space-x-2">
    {renderFavicon(article.source.domain)}
    <div className="flex items-center space-x-2">
      {article.url ? (
        <a 
          href={article.url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="hover:underline text-blue-600"
        >
          {article.source.name || article.source.domain || 'Unknown Source'}
        </a>
      ) : (
        <span>{article.source.name || article.source.domain || 'Unknown Source'}</span>
      )}
      <span>-</span>
      <span>{article.pubDate ? formatDate(article.pubDate) : 'Unknown Date'}</span>
    </div>
  </CardDescription>
</CardHeader>
<CardContent className="flex-grow">
    <p className="text-gray-700 line-clamp-3">{article.content}</p>
  </CardContent>
  {sourceType === 'faith' && (
    <CardFooter className="flex flex-col items-stretch">
      <Button 
        className="w-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center mb-2"
        onClick={() => handleCheckMainstream(article.articleId, article.title, article.content)}
        disabled={loadingResponses[article.articleId]}
      >
        {loadingResponses[article.articleId] ? 'Loading...' : 'Go Deeper'} <ArrowRight className="ml-2" />
      </Button>
      
      {perigonResponses[article.articleId] && (
        <div 
          className="mt-2 text-sm text-gray-700 w-full"
          dangerouslySetInnerHTML={{ 
            __html: formatPerigonResponse(
              perigonResponses[article.articleId].content, 
              perigonResponses[article.articleId].citations
            ) 
          }}
        />
      )}
    </CardFooter>
  )}

</Card>
            );
          })
        ) : (
          <div className="col-span-3 text-center text-gray-500">No news articles found.</div>
        )}
      </div>
    </div>
  );
};

export default NewsApp;