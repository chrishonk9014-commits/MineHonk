/** Achievements (data-driven). Triggers are checked by the server. */
export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** Parent achievement shown as prerequisite in the UI tree. */
  parent?: string;
  secret?: boolean;
  category: 'story' | 'nether' | 'end' | 'adventure' | 'farlands' | 'husbandry';
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'root', title: 'MineHonk', description: 'The heart and story of the game', icon: 'grass_block', category: 'story' },
  { id: 'mine_block', title: 'Getting Wood', description: 'Break your first block', icon: 'oak_log', parent: 'root', category: 'story' },
  { id: 'craft_table', title: 'Benchmarking', description: 'Craft a crafting table', icon: 'crafting_table', parent: 'mine_block', category: 'story' },
  { id: 'craft_tool', title: 'Time to Mine!', description: 'Craft your first tool', icon: 'wooden_pickaxe', parent: 'craft_table', category: 'story' },
  { id: 'stone_age', title: 'Stone Age', description: 'Mine stone with your new pickaxe', icon: 'cobblestone', parent: 'craft_tool', category: 'story' },
  { id: 'upgrade_tools', title: 'Getting an Upgrade', description: 'Craft a better pickaxe', icon: 'stone_pickaxe', parent: 'stone_age', category: 'story' },
  { id: 'smelt_iron', title: 'Acquire Hardware', description: 'Smelt an iron ingot', icon: 'iron_ingot', parent: 'upgrade_tools', category: 'story' },
  { id: 'iron_tools', title: "Isn't It Iron Pick", description: 'Craft an iron pickaxe', icon: 'iron_pickaxe', parent: 'smelt_iron', category: 'story' },
  { id: 'obtain_armor', title: 'Suit Up', description: 'Protect yourself with a piece of iron armor', icon: 'iron_chestplate', parent: 'smelt_iron', category: 'story' },
  { id: 'mine_diamond', title: 'Diamonds!', description: 'Acquire diamonds', icon: 'diamond', parent: 'iron_tools', category: 'story' },
  { id: 'enchant_item', title: 'Enchanter', description: 'Enchant an item at an Enchanting Table', icon: 'enchanted_book', parent: 'mine_diamond', category: 'story' },
  { id: 'form_obsidian', title: 'Ice Bucket Challenge', description: 'Obtain a block of obsidian', icon: 'obsidian', parent: 'iron_tools', category: 'story' },
  { id: 'enter_nether', title: 'We Need to Go Deeper', description: 'Build, light and enter a Nether Portal', icon: 'flint_and_steel', parent: 'form_obsidian', category: 'nether' },
  { id: 'find_fortress', title: 'A Terrible Fortress', description: 'Break your way into a Nether Fortress', icon: 'nether_bricks', parent: 'enter_nether', category: 'nether' },
  { id: 'obtain_blaze_rod', title: 'Into Fire', description: 'Relieve a Blaze of its rod', icon: 'blaze_rod', parent: 'find_fortress', category: 'nether' },
  { id: 'obtain_ancient_debris', title: 'Hidden in the Depths', description: 'Obtain Ancient Debris', icon: 'ancient_debris', parent: 'enter_nether', category: 'nether' },
  { id: 'netherite_armor', title: 'Cover Me in Debris', description: 'Get a full suit of Netherite armor', icon: 'netherite_chestplate', parent: 'obtain_ancient_debris', category: 'nether' },
  { id: 'kill_ember_beast', title: 'Firefighter', description: 'Defeat an Ember Beast', icon: 'ember_core', parent: 'enter_nether', category: 'nether' },
  { id: 'follow_ender_eye', title: 'Eye Spy', description: 'Follow an Eye of Ender to a Stronghold', icon: 'ender_eye', parent: 'obtain_blaze_rod', category: 'story' },
  { id: 'enter_end', title: 'The End?', description: 'Enter the End Portal', icon: 'end_stone', parent: 'follow_ender_eye', category: 'end' },
  { id: 'kill_dragon', title: 'Free the End', description: 'Defeat the Ender Dragon', icon: 'dragon_egg', parent: 'enter_end', category: 'end' },
  { id: 'find_end_city', title: 'The City at the End of the Game', description: 'Go on in, what could happen?', icon: 'purpur_block', parent: 'kill_dragon', category: 'end' },
  { id: 'elytra', title: 'Sky\'s the Limit', description: 'Find Elytra', icon: 'elytra', parent: 'find_end_city', category: 'end' },
  { id: 'corrupted_eye', title: 'Something Is Wrong', description: 'Obtain a Corrupted Eye', icon: 'corrupted_eye', parent: 'kill_dragon', category: 'farlands', secret: true },
  { id: 'find_far_portal', title: 'Edge of the Map', description: 'Discover a glitched portal', icon: 'far_portal_frame', parent: 'root', category: 'farlands', secret: true },
  { id: 'enter_farlands', title: 'Welcome to the Far Lands', description: 'Enter the Farlands', icon: 'farstone', parent: 'find_far_portal', category: 'farlands', secret: true },
  { id: 'glitched_gear', title: 'Out of Bounds', description: 'Upgrade gear to Glitched', icon: 'glitched_pickaxe', parent: 'enter_farlands', category: 'farlands', secret: true },
  { id: 'kill_glitch_beast', title: 'Stack Overflow', description: 'Defeat the Glitch Beast', icon: 'glitch_core', parent: 'enter_farlands', category: 'farlands', secret: true },
  { id: 'all_dimensions', title: 'Dimension Hopper', description: 'Visit every dimension', icon: 'far_portal', parent: 'enter_farlands', category: 'adventure' },
  { id: 'kill_mob', title: 'Monster Hunter', description: 'Kill any hostile monster', icon: 'iron_sword', parent: 'root', category: 'adventure' },
  { id: 'kill_stalker', title: 'Hunter Hunted', description: 'Defeat a Cave Stalker', icon: 'stalker_fang', parent: 'kill_mob', category: 'adventure' },
  { id: 'sleep_bed', title: 'Sweet Dreams', description: 'Sleep in a bed to change your respawn point', icon: 'red_bed', parent: 'root', category: 'adventure' },
  { id: 'trade', title: "What a Deal!", description: 'Successfully trade with a Villager', icon: 'emerald', parent: 'root', category: 'adventure' },
  { id: 'find_village', title: 'Neighbourhood Watch', description: 'Find a village', icon: 'bell', parent: 'root', category: 'adventure' },
  { id: 'find_temple', title: 'Tomb Raider', description: 'Find a temple', icon: 'chiseled_sandstone', parent: 'root', category: 'adventure' },
  { id: 'find_sky_shrine', title: 'Above the Clouds', description: 'Discover a Sky Shrine', icon: 'sky_ray_membrane', parent: 'root', category: 'adventure', secret: true },
  { id: 'level_30', title: 'Experienced', description: 'Reach experience level 30', icon: 'experience_bottle', parent: 'root', category: 'adventure' },
  { id: 'plant_seed', title: 'A Seedy Place', description: 'Plant a seed and watch it grow', icon: 'wheat_seeds', parent: 'root', category: 'husbandry' },
  { id: 'bake_bread', title: 'Bake Bread', description: 'Turn wheat into bread', icon: 'bread', parent: 'plant_seed', category: 'husbandry' },
  { id: 'eat_sunroot', title: 'Sun Snack', description: 'Eat a Sunroot', icon: 'sunroot', parent: 'plant_seed', category: 'husbandry' },
  { id: 'breed_animals', title: 'The Parrots and the Bats', description: 'Breed two animals together', icon: 'wheat', parent: 'root', category: 'husbandry' },
  { id: 'tame_wolf', title: 'Best Friends Forever', description: 'Tame a wolf', icon: 'bone', parent: 'root', category: 'husbandry' },
];

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));
