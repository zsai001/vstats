package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ============================================================================
// Server Management Handlers
// ============================================================================

func (s *AppState) GetServers(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()
	c.JSON(http.StatusOK, s.Config.Servers)
}

func (s *AppState) AddServer(c *gin.Context) {
	var req AddServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	server := RemoteServer{
		ID:           uuid.New().String(),
		Name:         req.Name,
		URL:          req.URL,
		Location:     req.Location,
		Provider:     req.Provider,
		Tag:          req.Tag,
		Token:        uuid.New().String(),
		GroupID:      req.GroupID,
		GroupValues:  req.GroupValues,
		PriceAmount:  req.PriceAmount,
		PricePeriod:  req.PricePeriod,
		PurchaseDate: req.PurchaseDate,
		TipBadge:     req.TipBadge,
	}

	s.ConfigMu.Lock()
	s.Config.Servers = append(s.Config.Servers, server)
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.JSON(http.StatusOK, server)
}

func (s *AppState) DeleteServer(c *gin.Context) {
	id := c.Param("id")

	s.ConfigMu.Lock()
	servers := make([]RemoteServer, 0)
	for _, srv := range s.Config.Servers {
		if srv.ID != id {
			servers = append(servers, srv)
		}
	}
	s.Config.Servers = servers
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	s.AgentMetricsMu.Lock()
	delete(s.AgentMetrics, id)
	s.AgentMetricsMu.Unlock()

	c.Status(http.StatusOK)
}

func (s *AppState) UpdateServer(c *gin.Context) {
	id := c.Param("id")

	var req UpdateServerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	var updated *RemoteServer
	for i := range s.Config.Servers {
		if s.Config.Servers[i].ID == id {
			if req.Name != nil {
				s.Config.Servers[i].Name = *req.Name
			}
			if req.Location != nil {
				s.Config.Servers[i].Location = *req.Location
			}
			if req.Provider != nil {
				s.Config.Servers[i].Provider = *req.Provider
			}
			if req.Tag != nil {
				s.Config.Servers[i].Tag = *req.Tag
			}
			if req.GroupID != nil {
				s.Config.Servers[i].GroupID = *req.GroupID
			}
			if req.GroupValues != nil {
				s.Config.Servers[i].GroupValues = *req.GroupValues
			}
			if req.PriceAmount != nil {
				s.Config.Servers[i].PriceAmount = *req.PriceAmount
			}
			if req.PricePeriod != nil {
				s.Config.Servers[i].PricePeriod = *req.PricePeriod
			}
			if req.PurchaseDate != nil {
				s.Config.Servers[i].PurchaseDate = *req.PurchaseDate
			}
			if req.TipBadge != nil {
				s.Config.Servers[i].TipBadge = *req.TipBadge
			}
			updated = &s.Config.Servers[i]
			break
		}
	}

	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Server not found"})
		return
	}

	SaveConfig(s.Config)
	c.JSON(http.StatusOK, updated)
}

// ============================================================================
// Group Management Handlers
// ============================================================================

func (s *AppState) GetGroups(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()

	groups := s.Config.Groups
	if groups == nil {
		groups = []ServerGroup{}
	}
	c.JSON(http.StatusOK, groups)
}

func (s *AppState) AddGroup(c *gin.Context) {
	var req AddGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	group := ServerGroup{
		ID:        uuid.New().String(),
		Name:      req.Name,
		SortOrder: req.SortOrder,
	}

	s.ConfigMu.Lock()
	if s.Config.Groups == nil {
		s.Config.Groups = []ServerGroup{}
	}
	s.Config.Groups = append(s.Config.Groups, group)
	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.JSON(http.StatusOK, group)
}

func (s *AppState) UpdateGroup(c *gin.Context) {
	id := c.Param("id")

	var req UpdateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	var updated *ServerGroup
	for i := range s.Config.Groups {
		if s.Config.Groups[i].ID == id {
			if req.Name != nil {
				s.Config.Groups[i].Name = *req.Name
			}
			if req.SortOrder != nil {
				s.Config.Groups[i].SortOrder = *req.SortOrder
			}
			updated = &s.Config.Groups[i]
			break
		}
	}

	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}

	SaveConfig(s.Config)
	c.JSON(http.StatusOK, updated)
}

func (s *AppState) DeleteGroup(c *gin.Context) {
	id := c.Param("id")

	s.ConfigMu.Lock()

	// Remove group
	groups := make([]ServerGroup, 0)
	for _, g := range s.Config.Groups {
		if g.ID != id {
			groups = append(groups, g)
		}
	}
	s.Config.Groups = groups

	// Clear group_id from servers that had this group
	for i := range s.Config.Servers {
		if s.Config.Servers[i].GroupID == id {
			s.Config.Servers[i].GroupID = ""
		}
	}

	// Clear group_id from local node if it had this group
	if s.Config.LocalNode.GroupID == id {
		s.Config.LocalNode.GroupID = ""
	}

	SaveConfig(s.Config)
	s.ConfigMu.Unlock()

	c.Status(http.StatusOK)
}

// ============================================================================
// Dimension Management Handlers
// ============================================================================

func (s *AppState) GetDimensions(c *gin.Context) {
	s.ConfigMu.RLock()
	defer s.ConfigMu.RUnlock()

	dimensions := s.Config.GroupDimensions
	if dimensions == nil {
		dimensions = []GroupDimension{}
	}
	c.JSON(http.StatusOK, dimensions)
}

func (s *AppState) AddDimension(c *gin.Context) {
	var req AddDimensionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	// Check if key already exists
	for _, d := range s.Config.GroupDimensions {
		if d.Key == req.Key {
			c.JSON(http.StatusConflict, gin.H{"error": "Dimension key already exists"})
			return
		}
	}

	dimension := GroupDimension{
		ID:        uuid.New().String(),
		Name:      req.Name,
		Key:       req.Key,
		Enabled:   req.Enabled,
		SortOrder: req.SortOrder,
		Options:   []GroupOption{},
	}

	if s.Config.GroupDimensions == nil {
		s.Config.GroupDimensions = []GroupDimension{}
	}
	s.Config.GroupDimensions = append(s.Config.GroupDimensions, dimension)
	SaveConfig(s.Config)

	c.JSON(http.StatusOK, dimension)
}

func (s *AppState) UpdateDimension(c *gin.Context) {
	id := c.Param("id")

	var req UpdateDimensionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	var updated *GroupDimension
	for i := range s.Config.GroupDimensions {
		if s.Config.GroupDimensions[i].ID == id {
			if req.Name != nil {
				s.Config.GroupDimensions[i].Name = *req.Name
			}
			if req.Enabled != nil {
				s.Config.GroupDimensions[i].Enabled = *req.Enabled
			}
			if req.SortOrder != nil {
				s.Config.GroupDimensions[i].SortOrder = *req.SortOrder
			}
			updated = &s.Config.GroupDimensions[i]
			break
		}
	}

	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Dimension not found"})
		return
	}

	SaveConfig(s.Config)
	c.JSON(http.StatusOK, updated)
}

func (s *AppState) DeleteDimension(c *gin.Context) {
	id := c.Param("id")

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	// Remove dimension
	dimensions := make([]GroupDimension, 0)
	for _, d := range s.Config.GroupDimensions {
		if d.ID != id {
			dimensions = append(dimensions, d)
		}
	}
	s.Config.GroupDimensions = dimensions

	// Clear group values from servers
	for i := range s.Config.Servers {
		if s.Config.Servers[i].GroupValues != nil {
			delete(s.Config.Servers[i].GroupValues, id)
		}
	}

	// Clear from local node
	if s.Config.LocalNode.GroupValues != nil {
		delete(s.Config.LocalNode.GroupValues, id)
	}

	SaveConfig(s.Config)
	c.Status(http.StatusOK)
}

// ============================================================================
// Dimension Option Handlers
// ============================================================================

func (s *AppState) AddOption(c *gin.Context) {
	dimID := c.Param("id")

	var req AddOptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	var dimension *GroupDimension
	for i := range s.Config.GroupDimensions {
		if s.Config.GroupDimensions[i].ID == dimID {
			dimension = &s.Config.GroupDimensions[i]
			break
		}
	}

	if dimension == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Dimension not found"})
		return
	}

	option := GroupOption{
		ID:        uuid.New().String(),
		Name:      req.Name,
		SortOrder: req.SortOrder,
	}

	dimension.Options = append(dimension.Options, option)
	SaveConfig(s.Config)

	c.JSON(http.StatusOK, option)
}

func (s *AppState) UpdateOption(c *gin.Context) {
	dimID := c.Param("id")
	optID := c.Param("option_id")

	var req UpdateOptionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	var updated *GroupOption
	for i := range s.Config.GroupDimensions {
		if s.Config.GroupDimensions[i].ID == dimID {
			for j := range s.Config.GroupDimensions[i].Options {
				if s.Config.GroupDimensions[i].Options[j].ID == optID {
					if req.Name != nil {
						s.Config.GroupDimensions[i].Options[j].Name = *req.Name
					}
					if req.SortOrder != nil {
						s.Config.GroupDimensions[i].Options[j].SortOrder = *req.SortOrder
					}
					updated = &s.Config.GroupDimensions[i].Options[j]
					break
				}
			}
			break
		}
	}

	if updated == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Option not found"})
		return
	}

	SaveConfig(s.Config)
	c.JSON(http.StatusOK, updated)
}

func (s *AppState) DeleteOption(c *gin.Context) {
	dimID := c.Param("id")
	optID := c.Param("option_id")

	s.ConfigMu.Lock()
	defer s.ConfigMu.Unlock()

	found := false
	for i := range s.Config.GroupDimensions {
		if s.Config.GroupDimensions[i].ID == dimID {
			options := make([]GroupOption, 0)
			for _, o := range s.Config.GroupDimensions[i].Options {
				if o.ID != optID {
					options = append(options, o)
				} else {
					found = true
				}
			}
			s.Config.GroupDimensions[i].Options = options
			break
		}
	}

	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "Option not found"})
		return
	}

	// Clear this option from servers
	for i := range s.Config.Servers {
		if s.Config.Servers[i].GroupValues != nil {
			for k, v := range s.Config.Servers[i].GroupValues {
				if v == optID {
					delete(s.Config.Servers[i].GroupValues, k)
				}
			}
		}
	}

	// Clear from local node
	if s.Config.LocalNode.GroupValues != nil {
		for k, v := range s.Config.LocalNode.GroupValues {
			if v == optID {
				delete(s.Config.LocalNode.GroupValues, k)
			}
		}
	}

	SaveConfig(s.Config)
	c.Status(http.StatusOK)
}
