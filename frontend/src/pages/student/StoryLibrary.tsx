
import React from 'react';
import { Story } from '../../types';

interface StoryLibraryProps {
  onStartReading: (story: Story) => void;
  limit?: number;
}

export const MOCK_STORIES: Story[] = [
  {
    id: '1',
    title: '揠苗助長的故事',
    filename: '揠苗助長.txt',
    level: 3,
    category: 'Fable',
    thumbnail: 'https://picsum.photos/seed/farmer/400/300',
    intro: {
      author: '出自《孟子·公孫丑上》，戰國時代儒家學者孟子所著',
      background: '這篇故事出自兩千多年前的儒家經典《孟子》。故事說的是一個農夫，因為太心急想讓禾苗快點長高，就把禾苗一棵一棵往上拔，結果反而害死了禾苗。這個寓言告訴我們做任何事情都要順著自然的規律，不能急於求成，否則反而會壞事。',
    },
    content: [
      '古時候有一個農夫，他每天都去田裡看禾苗長高了沒有。他覺得禾苗長得太慢了，心裡非常著急。',
      '有一天，他想到一個辦法，把禾苗一棵一棵往上拔高。他累得滿頭大汗回到家，對家人說：「今天可把我累壞了！我幫田裡的禾苗都長高了一大截！」',
      '他的兒子聽了趕快跑去田裡看，結果禾苗全部都枯死了。'
    ]
  },
  {
    id: '2',
    title: '神祕的玉山',
    filename: '玉山傳奇.txt',
    level: 4,
    category: 'Science',
    thumbnail: 'https://picsum.photos/seed/mountain/400/300',
    intro: {
      author: '台灣自然生態知識讀本編輯群',
      background: '玉山海拔三千九百五十二公尺，是台灣第一高峰，也是東北亞最高的山。它不只是地理上的奇蹟，更擁有從亞熱帶到高山寒帶的豐富生態，許多植物和動物只有在這裡才找得到。讀完這篇文章，你會對台灣這片珍貴的自然寶地有更深的認識。',
    },
    content: [
      '玉山是台灣最高的一座山，也是東北亞的第一高峰。它的高度將近四千公尺，山頂在冬天時常會覆蓋著白雪。',
      '玉山擁有豐富的生態環境，可以看到許多特有的植物。保護這片美麗的山林，是我們每一個人的責任。'
    ]
  },
  {
    id: '3',
    title: '珍珠奶茶的發明',
    filename: '珍奶故事.txt',
    level: 3,
    category: 'Daily',
    thumbnail: 'https://picsum.photos/seed/boba/400/300',
    intro: {
      author: '台灣生活文化讀本編輯群',
      background: '珍珠奶茶是台灣在一九八〇年代發明的特色飲料，現在已經風靡全世界，成為台灣最具代表性的文化符號之一。那顆顆黑色圓潤的珍珠，其實是用地瓜粉或木薯粉做成的粉圓。這篇文章會帶你了解珍珠奶茶的特色，以及它為什麼讓那麼多人著迷。',
    },
    content: [
      '珍珠奶茶是台灣最著名的飲料之一，聞名全世界。它是由香醇的奶茶加上Ｑ彈的粉圓組合而成的。',
      '咬下珍珠時那種有彈性的口感，深受大家喜愛。如果你有外國朋友來台灣，一定要帶他們去喝一杯。'
    ]
  }
];

const StoryLibrary: React.FC<StoryLibraryProps> = ({ onStartReading, limit }) => {
  const stories = limit ? MOCK_STORIES.slice(0, limit) : MOCK_STORIES;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {stories.map((story) => (
        <div 
          key={story.id} 
          className="bg-[#161b22] rounded-xl overflow-hidden border border-[#30363d] hover:border-indigo-500 transition-all cursor-pointer group"
          onClick={() => onStartReading(story)}
        >
          <div className="h-40 overflow-hidden relative">
            <img 
              src={story.thumbnail} 
              alt={story.title} 
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          </div>
          <div className="p-4">
            <h4 className="text-white font-bold mb-1">{story.title}</h4>
            <div className="text-[10px] text-slate-500 font-mono">{story.filename}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default StoryLibrary;
