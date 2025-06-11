class AnimeRecommendationSystem {
    constructor() {
        this.apiBaseUrl = 'https://api.jikan.moe/v4';
        this.searchCache = new Map();
        this.currentAnime = null;
        this.recommendations = [];
        this.isLoading = false;
        
        this.initializeElements();
        this.bindEvents();
    }

    initializeElements() {
        // Search elements
        this.searchInput = document.getElementById('searchInput');
        this.searchBtn = document.getElementById('searchBtn');
        this.searchSuggestions = document.getElementById('searchSuggestions');
        
        // Results elements
        this.resultsContainer = document.getElementById('resultsContainer');
        this.resultsTitle = document.getElementById('resultsTitle');
        this.resultsGrid = document.getElementById('resultsGrid');
        this.sortSelect = document.getElementById('sortSelect');
        
        // State elements
        this.loadingState = document.getElementById('loadingState');
        this.errorState = document.getElementById('errorState');
        this.emptyState = document.getElementById('emptyState');
        this.errorMessage = document.getElementById('errorMessage');
        this.retryBtn = document.getElementById('retryBtn');
        
        // Modal elements
        this.modal = document.getElementById('animeModal');
        this.modalClose = document.getElementById('modalClose');
        this.modalBackdrop = this.modal.querySelector('.modal-backdrop');
    }

    bindEvents() {
        // Search events
        this.searchBtn.addEventListener('click', () => this.handleSearch());
        this.searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSearch();
        });
        this.searchInput.addEventListener('input', this.debounce(() => this.handleAutocomplete(), 300));
        this.searchInput.addEventListener('blur', () => {
            // Delay hiding suggestions to allow clicking
            setTimeout(() => this.hideSuggestions(), 150);
        });
        
        // Sort event
        this.sortSelect.addEventListener('change', () => this.sortRecommendations());
        
        // Retry event
        this.retryBtn.addEventListener('click', () => this.handleSearch());
        
        // Modal events
        this.modalClose.addEventListener('click', () => this.closeModal());
        this.modalBackdrop.addEventListener('click', () => this.closeModal());
        
        // Global events
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();
        });
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    async handleSearch() {
        const query = this.searchInput.value.trim();
        if (!query || this.isLoading) return;

        this.setLoadingState(true);
        this.hideStates();
        this.showLoadingState();
        this.hideSuggestions();

        try {
            console.log('Searching for:', query);
            
            // Search for the anime
            const searchResults = await this.searchAnime(query);
            console.log('Search results:', searchResults);
            
            if (!searchResults || searchResults.length === 0) {
                this.showEmptyState();
                return;
            }

            // Use the first result as source anime
            this.currentAnime = searchResults[0];
            console.log('Selected anime:', this.currentAnime);
            
            // Get more anime data for recommendations
            const allAnimeData = await this.fetchAnimeDatabase();
            console.log('Fetched anime database:', allAnimeData.length, 'entries');
            
            // Calculate recommendations
            this.recommendations = this.calculateRecommendations(this.currentAnime, allAnimeData);
            console.log('Calculated recommendations:', this.recommendations.length);
            
            // Display results
            this.displayResults();
            
        } catch (error) {
            console.error('Search error:', error);
            this.showErrorState(`Failed to search for anime: ${error.message}`);
        } finally {
            this.setLoadingState(false);
        }
    }

    async handleAutocomplete() {
        const query = this.searchInput.value.trim();
        if (query.length < 2) {
            this.hideSuggestions();
            return;
        }

        try {
            const results = await this.searchAnime(query, 5);
            this.showSuggestions(results);
        } catch (error) {
            console.warn('Autocomplete error:', error);
            this.hideSuggestions();
        }
    }

    async searchAnime(query, limit = 25) {
        const cacheKey = `${query}-${limit}`;
        if (this.searchCache.has(cacheKey)) {
            return this.searchCache.get(cacheKey);
        }

        // Add delay to respect rate limits
        await this.delay(250);

        const url = `${this.apiBaseUrl}/anime?q=${encodeURIComponent(query)}&limit=${limit}&order_by=popularity&sort=asc`;
        console.log('Fetching:', url);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            if (response.status === 429) {
                throw new Error('Too many requests. Please wait a moment and try again.');
            }
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = await response.json();
        const results = data.data || [];
        
        // Cache results for 5 minutes
        this.searchCache.set(cacheKey, results);
        setTimeout(() => this.searchCache.delete(cacheKey), 5 * 60 * 1000);
        
        return results;
    }

    async fetchAnimeDatabase() {
        // Use a simpler approach to get anime data
        const queries = ['popular', 'action', 'adventure', 'drama', 'fantasy'];
        const allData = [];
        
        for (const query of queries) {
            try {
                await this.delay(500); // Rate limiting
                const results = await this.searchAnime(query, 20);
                allData.push(...results);
            } catch (error) {
                console.warn(`Failed to fetch anime for query "${query}":`, error);
            }
        }

        // Remove duplicates and current anime
        const uniqueAnime = allData.filter((anime, index, self) => 
            anime.mal_id !== this.currentAnime.mal_id &&
            index === self.findIndex(a => a.mal_id === anime.mal_id)
        );

        return uniqueAnime.slice(0, 100); // Limit to 100 for performance
    }

    calculateRecommendations(sourceAnime, animeList) {
        const recommendations = animeList.map(anime => ({
            ...anime,
            similarity: this.calculateSimilarity(sourceAnime, anime)
        }));

        // Sort by similarity and return top 12
        return recommendations
            .filter(anime => anime.similarity > 0.05) // Lower threshold for more results
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 12);
    }

    calculateSimilarity(sourceAnime, targetAnime) {
        const weights = {
            genre: 0.4,
            score: 0.2,
            type: 0.15,
            year: 0.15,
            episodes: 0.1
        };

        // Genre similarity using Jaccard index
        const genreSimilarity = this.calculateGenreSimilarity(
            sourceAnime.genres || [], 
            targetAnime.genres || []
        );

        // Score similarity (normalized)
        const sourceScore = sourceAnime.score || 0;
        const targetScore = targetAnime.score || 0;
        const scoreSimilarity = sourceScore > 0 && targetScore > 0 ? 
            Math.max(0, 1 - Math.abs(sourceScore - targetScore) / 10) : 0.5;

        // Type similarity
        const typeSimilarity = sourceAnime.type === targetAnime.type ? 1 : 0.3;

        // Year similarity (normalized)
        const sourceYear = sourceAnime.aired?.from ? new Date(sourceAnime.aired.from).getFullYear() : 0;
        const targetYear = targetAnime.aired?.from ? new Date(targetAnime.aired.from).getFullYear() : 0;
        const yearSimilarity = sourceYear > 0 && targetYear > 0 ? 
            Math.max(0, 1 - Math.abs(sourceYear - targetYear) / 30) : 0.5;

        // Episode similarity (normalized)
        const sourceEpisodes = sourceAnime.episodes || 0;
        const targetEpisodes = targetAnime.episodes || 0;
        const episodeSimilarity = sourceEpisodes > 0 && targetEpisodes > 0 ? 
            Math.max(0, 1 - Math.abs(sourceEpisodes - targetEpisodes) / 50) : 0.5;

        // Weighted combination
        return (genreSimilarity * weights.genre) + 
               (scoreSimilarity * weights.score) + 
               (typeSimilarity * weights.type) + 
               (yearSimilarity * weights.year) + 
               (episodeSimilarity * weights.episodes);
    }

    calculateGenreSimilarity(genres1, genres2) {
        if (!genres1.length && !genres2.length) return 0.5;
        if (!genres1.length || !genres2.length) return 0.1;

        const set1 = new Set(genres1.map(g => (g.name || g).toLowerCase()));
        const set2 = new Set(genres2.map(g => (g.name || g).toLowerCase()));
        
        const intersection = new Set([...set1].filter(x => set2.has(x)));
        const union = new Set([...set1, ...set2]);
        
        return intersection.size / Math.max(union.size, 1); // Prevent division by zero
    }

    showSuggestions(suggestions) {
        if (!suggestions || suggestions.length === 0) {
            this.hideSuggestions();
            return;
        }

        const html = suggestions.slice(0, 5).map(anime => `
            <div class="suggestion-item" data-title="${anime.title}">
                ${anime.title} ${anime.title_japanese ? `(${anime.title_japanese})` : ''}
            </div>
        `).join('');

        this.searchSuggestions.innerHTML = html;
        this.searchSuggestions.classList.remove('hidden');

        // Add click handlers
        this.searchSuggestions.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                const title = item.dataset.title;
                this.searchInput.value = title;
                this.hideSuggestions();
                setTimeout(() => this.handleSearch(), 100);
            });
        });
    }

    hideSuggestions() {
        this.searchSuggestions.classList.add('hidden');
    }

    displayResults() {
        this.hideStates();
        
        this.resultsTitle.textContent = `Similar to "${this.currentAnime.title}"`;
        this.resultsContainer.classList.remove('hidden');
        
        this.renderAnimeGrid();
    }

    renderAnimeGrid() {
        const html = this.recommendations.map(anime => this.createAnimeCard(anime)).join('');
        this.resultsGrid.innerHTML = html;
        this.resultsGrid.classList.add('fade-in');

        // Add click handlers
        this.resultsGrid.querySelectorAll('.anime-card').forEach(card => {
            card.addEventListener('click', () => {
                const animeId = card.dataset.animeId;
                const anime = this.recommendations.find(a => a.mal_id.toString() === animeId);
                if (anime) this.showModal(anime);
            });
        });
    }

    createAnimeCard(anime) {
        const genres = (anime.genres || []).slice(0, 3).map(g => 
            `<span class="genre-badge">${g.name || g}</span>`
        ).join('');

        const score = anime.score || 0;
        
        const year = anime.aired?.from ? new Date(anime.aired.from).getFullYear() : 'N/A';
        const episodes = anime.episodes || 'N/A';
        const synopsis = anime.synopsis ? 
            (anime.synopsis.length > 150 ? anime.synopsis.substring(0, 150) + '...' : anime.synopsis) : 
            'No synopsis available.';

        const similarityPercent = Math.round((anime.similarity || 0) * 100);
        const imageUrl = anime.images?.jpg?.image_url || anime.images?.jpg?.large_image_url || '';

        return `
            <div class="anime-card" data-anime-id="${anime.mal_id}">
                <div class="similarity-badge">${similarityPercent}% Match</div>
                ${imageUrl ? `<img class="anime-card__image" src="${imageUrl}" alt="${anime.title}" onerror="this.style.display='none'">` : ''}
                <div class="anime-card__content">
                    <div class="anime-card__header">
                        <h3 class="anime-card__title">${anime.title}</h3>
                        ${anime.title_japanese ? `<p class="anime-card__title-japanese">${anime.title_japanese}</p>` : ''}
                    </div>
                    
                    ${genres ? `<div class="anime-card__genres">${genres}</div>` : ''}
                    
                    <div class="anime-card__stats">
                        <div class="stat">
                            <span class="stat-label">Score:</span>
                            <span class="stat-value">${score > 0 ? score.toFixed(1) : 'N/A'}</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Type:</span>
                            <span class="stat-value">${anime.type || 'N/A'}</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Episodes:</span>
                            <span class="stat-value">${episodes}</span>
                        </div>
                        <div class="stat">
                            <span class="stat-label">Year:</span>
                            <span class="stat-value">${year}</span>
                        </div>
                    </div>
                    
                    <p class="anime-card__synopsis">${synopsis}</p>
                </div>
            </div>
        `;
    }

    sortRecommendations() {
        const sortBy = this.sortSelect.value;
        
        switch (sortBy) {
            case 'similarity':
                this.recommendations.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
                break;
            case 'score':
                this.recommendations.sort((a, b) => (b.score || 0) - (a.score || 0));
                break;
            case 'popularity':
                this.recommendations.sort((a, b) => (a.popularity || Infinity) - (b.popularity || Infinity));
                break;
        }
        
        this.renderAnimeGrid();
    }

    showModal(anime) {
        const modal = this.modal;
        
        // Populate modal content
        document.getElementById('modalTitle').textContent = anime.title || 'Unknown Title';
        
        const imageUrl = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url || '';
        const modalImage = document.getElementById('modalImage');
        if (imageUrl) {
            modalImage.src = imageUrl;
            modalImage.style.display = 'block';
        } else {
            modalImage.style.display = 'none';
        }
        
        document.getElementById('modalScore').textContent = anime.score ? anime.score.toFixed(1) : 'N/A';
        document.getElementById('modalType').textContent = anime.type || 'N/A';
        document.getElementById('modalEpisodes').textContent = anime.episodes || 'N/A';
        
        const year = anime.aired?.from ? new Date(anime.aired.from).getFullYear() : 'N/A';
        document.getElementById('modalYear').textContent = year;
        
        const genres = (anime.genres || []).map(g => 
            `<span class="genre-badge">${g.name || g}</span>`
        ).join('');
        document.getElementById('modalGenres').innerHTML = genres;
        
        document.getElementById('modalSynopsis').textContent = anime.synopsis || 'No synopsis available.';
        
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    closeModal() {
        this.modal.classList.add('hidden');
        document.body.style.overflow = '';
    }

    setLoadingState(isLoading) {
        this.isLoading = isLoading;
        const btnText = this.searchBtn.querySelector('.search-btn__text');
        const btnLoading = this.searchBtn.querySelector('.search-btn__loading');
        
        if (isLoading) {
            btnText.classList.add('hidden');
            btnLoading.classList.remove('hidden');
            this.searchBtn.disabled = true;
        } else {
            btnText.classList.remove('hidden');
            btnLoading.classList.add('hidden');
            this.searchBtn.disabled = false;
        }
    }

    hideStates() {
        this.resultsContainer.classList.add('hidden');
        this.loadingState.classList.add('hidden');
        this.errorState.classList.add('hidden');
        this.emptyState.classList.add('hidden');
    }

    showLoadingState() {
        this.loadingState.classList.remove('hidden');
    }

    showErrorState(message = 'An error occurred while searching for anime.') {
        this.errorMessage.textContent = message;
        this.errorState.classList.remove('hidden');
    }

    showEmptyState() {
        this.emptyState.classList.remove('hidden');
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AnimeRecommendationSystem();
});