import React from 'react';
import { useNavigate } from 'react-router-dom';
import Intro from '../../components/reading-steps/Intro';
import { useLearningContext } from '../../layouts/LearningLayout';
import { isIslandStoryMode } from '../lab/island/storyMode';

/**
 * #3780 P0-3（playtest 2026-10-26）：故事模式下這一關的建築是「港口燈塔」
 * （見 `islandTemplate.ts` 的 `STEP_BUILDING_META['lesson-intro']`），做完
 * 這一關＝點亮它。「開始學習」孩子看不出這層對應，跟島上的視覺語言脫節。
 *
 * 這句短文案故意不 import `islandTemplate.ts`——那個檔案目前另有一批
 * （多篇課文）改動在進行中，為了不讓這次小改動跟它糾纏在同一次 code
 * review 的暫存區裡，直接把這句維護在消費端。
 */
const ISLAND_STORY_MODE_CTA = '讀完了，點亮燈塔';

const IntroPage: React.FC = () => {
  const { selectedStory, handleStartReading } = useLearningContext();
  const navigate = useNavigate();

  if (!selectedStory) return null;
  const storyMode = isIslandStoryMode();

  return (
    <Intro
      story={selectedStory}
      onStartReading={handleStartReading}
      onBack={storyMode ? undefined : () => navigate('/library')}
      storyMode={storyMode}
      storyModeCtaLabel={ISLAND_STORY_MODE_CTA}
    />
  );
};

export default IntroPage;
