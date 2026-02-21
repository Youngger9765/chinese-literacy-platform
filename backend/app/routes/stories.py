from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["stories"])

# Mock story data — mirrors frontend MOCK_STORIES for initial development
MOCK_STORIES = [
    {
        "id": "1",
        "title": "揠苗助長的故事",
        "filename": "揠苗助長.txt",
        "level": 3,
        "category": "Fable",
        "thumbnail": "https://picsum.photos/seed/farmer/400/300",
        "intro": {
            "author": "出自《孟子·公孫丑上》，戰國時代儒家學者孟子所著",
            "background": "這篇故事出自兩千多年前的儒家經典《孟子》。故事說的是一個農夫，因為太心急想讓禾苗快點長高，就把禾苗一棵一棵往上拔，結果反而害死了禾苗。這個寓言告訴我們做任何事情都要順著自然的規律，不能急於求成，否則反而會壞事。",
        },
        "content": [
            "古時候有一個農夫，他每天都去田裡看禾苗長高了沒有。",
            "他覺得禾苗長得太慢了，心裡非常著急。",
            "有一天，他想到一個辦法，把禾苗一棵一棵往上拔高。",
            "他累得滿頭大汗回到家，對家人說：「今天可把我累壞了！」",
            "「我幫田裡的禾苗都長高了一大截！」",
            "他的兒子聽了趕快跑去田裡看，結果禾苗全部都枯死了。",
        ],
    },
    {
        "id": "2",
        "title": "神祕的玉山",
        "filename": "玉山傳奇.txt",
        "level": 4,
        "category": "Science",
        "thumbnail": "https://picsum.photos/seed/mountain/400/300",
        "intro": {
            "author": "台灣自然生態知識讀本編輯群",
            "background": "玉山海拔三千九百五十二公尺，是台灣第一高峰，也是東北亞最高的山。它不只是地理上的奇蹟，更擁有從亞熱帶到高山寒帶的豐富生態，許多植物和動物只有在這裡才找得到。讀完這篇文章，你會對台灣這片珍貴的自然寶地有更深的認識。",
        },
        "content": [
            "玉山是台灣最高的一座山，也是東北亞的第一高峰。",
            "它的高度將近四千公尺，山頂在冬天時常會覆蓋著白雪。",
            "玉山擁有豐富的生態環境，可以看到許多特有的植物。",
            "保護這片美麗的山林，是我們每一個人的責任。",
        ],
    },
    {
        "id": "3",
        "title": "珍珠奶茶的發明",
        "filename": "珍奶故事.txt",
        "level": 3,
        "category": "Daily",
        "thumbnail": "https://picsum.photos/seed/boba/400/300",
        "intro": {
            "author": "台灣生活文化讀本編輯群",
            "background": "珍珠奶茶是台灣在一九八〇年代發明的特色飲料，現在已經風靡全世界，成為台灣最具代表性的文化符號之一。那顆顆黑色圓潤的珍珠，其實是用地瓜粉或木薯粉做成的粉圓。這篇文章會帶你了解珍珠奶茶的特色，以及它為什麼讓那麼多人著迷。",
        },
        "content": [
            "珍珠奶茶是台灣最著名的飲料之一，聞名全世界。",
            "它是由香醇的奶茶加上Ｑ彈的粉圓組合而成的。",
            "咬下珍珠時那種有彈性的口感，深受大家喜愛。",
            "如果你有外國朋友來台灣，一定要帶他們去喝一杯。",
        ],
    },
]

_story_index = {s["id"]: s for s in MOCK_STORIES}


@router.get("/stories")
def list_stories():
    """Return all available stories (mock data)."""
    return MOCK_STORIES


@router.get("/stories/{story_id}")
def get_story(story_id: str):
    """Return a single story by ID."""
    story = _story_index.get(story_id)
    if not story:
        raise HTTPException(status_code=404, detail="Story not found")
    return story
